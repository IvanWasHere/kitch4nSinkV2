import { errors as authErrors } from '@adonisjs/auth'
import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import { loginValidator } from '#validators/auth'
import { enabledSocialProviders } from '#config/ally'
import { startTwoFactorChallenge } from '#auth/two_factor_challenge'

export default class SessionController {
  async create({ view }: HttpContext) {
    return view.render('pages/auth/login', { socialProviders: enabledSocialProviders })
  }

  async store({ request, response, auth, session }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    let user: User
    try {
      user = await User.verifyCredentials(email, password)
    } catch (error) {
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        session.flashAll()
        session.flash('error', 'Those credentials do not match our records.')
        return response.redirect().toRoute('auth.session.create')
      }
      throw error
    }

    /**
     * A user with two-factor enabled is *not* logged in here. The session
     * only remembers who is halfway through signing in; the guard is not
     * touched until the second factor is proved.
     */
    if (user.hasTwoFactor) {
      startTwoFactorChallenge(session, 'web', user.id)
      return response.redirect().toRoute('auth.two_factor.create')
    }

    await auth.use('web').login(user)
    await user.recordLogin()

    return response.redirect().toRoute('dashboard.index')
  }

  async destroy({ response, auth }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect().toRoute('auth.session.create')
  }
}
