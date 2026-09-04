import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import StaffUser from '#models/staff_user'
import twoFactor from '#auth/two_factor_service'
import { twoFactorChallengeValidator } from '#validators/auth'
import {
  clearTwoFactorChallenge,
  pendingTwoFactorChallenge,
  type ChallengeGuard,
} from '#auth/two_factor_challenge'

/**
 * The second step of signing in. Serves both guards: tenant users at
 * /two-factor and staff at /admin/two-factor, because the code path is
 * identical and duplicating it is how the two drift apart.
 */
export default class TwoFactorChallengeController {
  async create({ view, session, response, request }: HttpContext) {
    const guard = this.guardFor(request.url())
    const pending = pendingTwoFactorChallenge(session, guard)

    if (!pending) {
      return response.redirect().toRoute(this.loginRoute(guard))
    }

    return view.render('pages/auth/two_factor_challenge', { guard })
  }

  async store({ request, response, session, auth }: HttpContext) {
    const guard = this.guardFor(request.url())
    const pending = pendingTwoFactorChallenge(session, guard)

    if (!pending) {
      session.flash('error', 'Your sign-in attempt timed out. Please start again.')
      return response.redirect().toRoute(this.loginRoute(guard))
    }

    const { code } = await request.validateUsing(twoFactorChallengeValidator)
    const subject =
      guard === 'staff'
        ? await StaffUser.find(pending.userId)
        : await User.query().where('id', pending.userId).whereNull('deleted_at').first()

    if (!subject) {
      clearTwoFactorChallenge(session)
      return response.redirect().toRoute(this.loginRoute(guard))
    }

    /**
     * One field accepts either an authenticator code or a recovery code:
     * being told "wrong box" while locked out is a bad moment to be pedantic.
     */
    const accepted =
      (await twoFactor.verify(subject, code)) ||
      (await twoFactor.consumeRecoveryCode(subject, code))

    if (!accepted) {
      session.flash('error', 'That code is not valid. Try again, or use a recovery code.')
      return response.redirect().toRoute(this.challengeRoute(guard))
    }

    clearTwoFactorChallenge(session)

    if (guard === 'staff') {
      await auth.use('staff').login(subject as StaffUser)
      await (subject as StaffUser).recordLogin()
      return response.redirect().toRoute('admin.dashboard')
    }

    await auth.use('web').login(subject as User)
    await (subject as User).recordLogin()
    return response.redirect().toRoute('dashboard.index')
  }

  private guardFor(url: string): ChallengeGuard {
    return url.startsWith('/admin') ? 'staff' : 'web'
  }

  private loginRoute(guard: ChallengeGuard) {
    return guard === 'staff' ? 'admin.session.create' : 'auth.session.create'
  }

  private challengeRoute(guard: ChallengeGuard) {
    return guard === 'staff' ? 'admin.two_factor.create' : 'auth.two_factor.create'
  }
}
