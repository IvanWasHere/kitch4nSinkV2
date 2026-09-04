import type { HttpContext } from '@adonisjs/core/http'

import mailer from '#mail/mailer_service'
import authTokens from '#auth/auth_token_service'
import registration from '#auth/registration_service'
import VerifyEmailNotification from '#mail/mails/verify_email_notification'
import { registerValidator } from '#validators/auth'
import { enabledSocialProviders } from '#config/ally'

/**
 * Signing up creates the organisation and its owner together (plan M1).
 */
export default class RegistrationController {
  async create({ view }: HttpContext) {
    return view.render('pages/auth/signup', { socialProviders: enabledSocialProviders })
  }

  async store({ request, response, auth, session }: HttpContext) {
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
