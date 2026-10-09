import router from '@adonisjs/core/services/router'
import type { HttpContext } from '@adonisjs/core/http'

import mailer from '#mail/mailer_service'
import authTokens from '#auth/auth_token_service'
import registration from '#auth/registration_service'
import registrationGate from '#auth/registration_gate'
import RegistrationClosedException from '#exceptions/registration_closed_exception'
import VerifyEmailNotification from '#mail/mails/verify_email_notification'
import { registerValidator } from '#validators/auth'
import { enabledSocialProviders } from '#config/ally'

/**
 * Signing up creates the organisation and its owner together (plan M1).
 */
export default class RegistrationController {
  /**
   * While registration is closed (plan §22.2) the form is not shown at all:
   * the waiting list takes its place when a feature provides one, and the
   * page says plainly that signup is closed when none does.
   */
  async create({ view, response }: HttpContext) {
    if (!(await registrationGate.isOpen())) {
      if (router.find('waitlist.create')) {
        return response.redirect().toPath(RegistrationClosedException.destination)
      }

      return view.render('pages/auth/signup', { registrationClosed: true, socialProviders: [] })
    }

    return view.render('pages/auth/signup', { socialProviders: enabledSocialProviders })
  }

  async store({ request, response, auth, session }: HttpContext) {
    /**
     * Before validation, not only inside the service: a closed form must not
     * answer "that email already has an account" to anybody probing it.
     */
    await registrationGate.assertOpen({ via: 'signup' })

    const payload = await request.validateUsing(registerValidator)

    const { user } = await registration.register({
      fullName: payload.fullName,
      email: payload.email,
      password: payload.password,
      organizationName: payload.organizationName ?? null,
    })

    const token = await authTokens.issue(user, 'verify_email')
    await mailer.send(new VerifyEmailNotification(user, token))

    await auth.use('web').login(user)
    await user.recordLogin()

    session.flash('success', `Welcome. We sent a confirmation link to ${user.email}.`)
    return response.redirect().toRoute('auth.verify_email.notice')
  }
}
