import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import mailer from '#mail/mailer_service'
import authTokens from '#auth/auth_token_service'
import ResetPasswordNotification from '#mail/mails/reset_password_notification'
import PasswordChangedNotification from '#mail/mails/password_changed_notification'
import { forgotPasswordValidator, resetPasswordValidator } from '#validators/auth'

export default class PasswordResetController {
  async create({ view }: HttpContext) {
    return view.render('pages/auth/forgot_password')
  }

  /**
   * Always reports success.
   *
   * Telling an anonymous visitor whether an address has an account turns this
   * form into an account-enumeration oracle, so the response is identical
   * either way and the difference is only whether an email goes out.
   */
  async store({ request, response, session }: HttpContext) {
    const { email } = await request.validateUsing(forgotPasswordValidator)

    const user = await User.query().where('email', email).whereNull('deleted_at').first()

    if (user) {
      const token = await authTokens.issue(user, 'reset_password')
      await mailer.send(new ResetPasswordNotification(user, token))
    }

    session.flash('success', 'If an account exists for that address, a reset link is on its way.')
    return response.redirect().toRoute('auth.password.create')
  }

  /**
   * The "choose a new password" form. The token is checked before rendering,
   * so an expired link says so instead of failing after the form is filled in.
   */
  async edit({ params, view, response, session }: HttpContext) {
    const record = await authTokens.find(params.token, 'reset_password')

    if (!record) {
      session.flash('error', 'That reset link has expired or has already been used.')
      return response.redirect().toRoute('auth.password.create')
    }

    return view.render('pages/auth/reset_password', { token: params.token })
  }

  async update({ params, request, response, session, auth }: HttpContext) {
    const { password } = await request.validateUsing(resetPasswordValidator)

    const user = await authTokens.consume(params.token, 'reset_password')

    if (!user) {
      session.flash('error', 'That reset link has expired or has already been used.')
      return response.redirect().toRoute('auth.password.create')
    }

    user.password = password
    await user.save()

    await mailer.send(new PasswordChangedNotification(user))

    /**
     * Resetting a password proves control of the mailbox, which is the same
     * evidence email verification asks for.
     */
    if (!user.hasVerifiedEmail) {
      user.emailVerifiedAt = user.updatedAt
      await user.save()
    }

    /**
     * Two-factor still applies: a reset link reaches the mailbox, and the
     * whole point of the second factor is that the mailbox is not enough.
     */
    if (user.hasTwoFactor) {
      session.flash('success', 'Your password has been reset. Sign in to continue.')
      return response.redirect().toRoute('auth.session.create')
    }

    await auth.use('web').login(user)
    await user.recordLogin()

    session.flash('success', 'Your password has been reset.')
    return response.redirect().toRoute('dashboard.index')
  }
}
