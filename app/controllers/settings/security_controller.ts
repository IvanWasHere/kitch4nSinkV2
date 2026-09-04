import hash from '@adonisjs/core/services/hash'
import type { HttpContext } from '@adonisjs/core/http'

import mailer from '#mail/mailer_service'
import twoFactor from '#auth/two_factor_service'
import PasswordChangedNotification from '#mail/mails/password_changed_notification'
import { changePasswordValidator, twoFactorConfirmValidator } from '#validators/auth'

/**
 * Password and two-factor management for the signed-in user.
 *
 * Recovery codes are shown exactly once, flashed to the next request rather
 * than stored, so a refresh cannot re-reveal them.
 */
export default class SecurityController {
  async edit({ view, auth, session }: HttpContext) {
    const user = auth.use('web').user!

    return view.render('pages/settings/security', {
      recoveryCodes: session.flashMessages.get('recoveryCodes') ?? null,
      enrolment: session.flashMessages.get('enrolment') ?? null,
      hasTwoFactor: user.hasTwoFactor,
      hasPassword: user.hasPassword,
    })
  }

  async updatePassword({ request, response, session, auth }: HttpContext) {
    const user = auth.use('web').user!
    const { currentPassword, password } = await request.validateUsing(changePasswordValidator)

    /**
     * A social-only account has no password to confirm, so the current
     * password check is skipped when there is nothing to check against.
     */
    if (user.hasPassword && !(await hash.verify(user.password!, currentPassword))) {
      session.flash('error', 'Your current password is not correct.')
      return response.redirect().toRoute('settings.security')
    }

    user.password = password
    await user.save()

    await mailer.send(new PasswordChangedNotification(user))

    session.flash('success', 'Your password has been updated.')
    return response.redirect().toRoute('settings.security')
  }

  /**
   * Step one of enabling two-factor: generate a secret and show the QR code.
   * The account is not protected until a code is confirmed.
   */
  async startTwoFactor({ auth, response, session }: HttpContext) {
    const user = auth.use('web').user!
    const { qrCodeSvg, secret } = await twoFactor.beginEnrolment(user)

    session.flash('enrolment', { qrCodeSvg, secret })
    return response.redirect().toRoute('settings.security')
  }

  async confirmTwoFactor({ request, auth, response, session }: HttpContext) {
    const user = auth.use('web').user!
    const { code } = await request.validateUsing(twoFactorConfirmValidator)

    const codes = await twoFactor.confirmEnrolment(user, code)

    if (!codes) {
      session.flash('error', 'That code is not valid. Scan the QR code again and retry.')
      return response.redirect().toRoute('settings.security')
    }

    session.flash('recoveryCodes', codes)
    session.flash('success', 'Two-factor authentication is on. Save your recovery codes now.')
    return response.redirect().toRoute('settings.security')
  }

  async regenerateRecoveryCodes({ auth, response, session }: HttpContext) {
    const user = auth.use('web').user!

    if (!user.hasTwoFactor) {
      return response.redirect().toRoute('settings.security')
    }

    session.flash('recoveryCodes', await twoFactor.regenerateRecoveryCodes(user))
    session.flash('success', 'New recovery codes generated. The old ones no longer work.')
    return response.redirect().toRoute('settings.security')
  }

  async disableTwoFactor({ auth, response, session }: HttpContext) {
    const user = auth.use('web').user!
    await twoFactor.disable(user)

    session.flash('success', 'Two-factor authentication is off.')
    return response.redirect().toRoute('settings.security')
  }
}
