import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

import mailer from '#mail/mailer_service'
import authTokens from '#auth/auth_token_service'
import Organization from '#models/organization'
import VerifyEmailNotification from '#mail/mails/verify_email_notification'
import WelcomeNotification from '#mail/mails/welcome_notification'

export default class EmailVerificationController {
  /**
   * The "check your email" screen. Reachable while signed in but unverified.
   */
  async notice({ view, auth, response }: HttpContext) {
    const user = auth.use('web').user!

    if (user.hasVerifiedEmail) {
      return response.redirect().toRoute('dashboard.index')
    }

    return view.render('pages/auth/verify_email')
  }

  /**
   * Follow the link from the email.
   *
   * Deliberately does not require a session: people open mail on a phone and
   * click the link in a browser that has never seen this site. The token is
   * the credential.
   */
  async verify({ params, response, session, auth }: HttpContext) {
    const user = await authTokens.consume(params.token, 'verify_email')

    if (!user) {
      session.flash('error', 'That confirmation link has expired or has already been used.')
      return response.redirect().toRoute('auth.verify_email.notice')
    }

    if (!user.hasVerifiedEmail) {
      user.emailVerifiedAt = DateTime.utc()
      await user.save()

      /**
       * Welcome is sent on confirmation rather than at signup: until the
       * address is proved there is nothing to welcome anyone to, and two
       * emails arriving together is noise.
       */
      const organization = await Organization.find(user.organizationId)
      if (organization) {
        await mailer.send(new WelcomeNotification(user, organization))
      }
    }

    /**
     * Confirming from a signed-out browser signs the user in — they have just
     * proved control of the address, which is a stronger claim than the
     * password alone.
     */
    if (!auth.use('web').isAuthenticated) {
      await auth.use('web').login(user)
      await user.recordLogin()
    }

    session.flash('success', 'Your email address is confirmed.')
    return response.redirect().toRoute('dashboard.index')
  }

  /**
   * Send a fresh link. Rate limiting lands in M8 along with the other auth
   * routes; until then the token service retires the previous link on every
   * request, so this cannot accumulate working links.
   */
  async resend({ auth, response, session }: HttpContext) {
    const user = auth.use('web').user!

    if (user.hasVerifiedEmail) {
      return response.redirect().toRoute('dashboard.index')
    }

    const token = await authTokens.issue(user, 'verify_email')
    await mailer.send(new VerifyEmailNotification(user, token))

    session.flash('success', `We sent another link to ${user.email}.`)
    return response.redirect().toRoute('auth.verify_email.notice')
  }
}
