import mail from '@adonisjs/mail/services/main'
import logger from '@adonisjs/core/services/logger'
import app from '@adonisjs/core/services/app'
import type { BaseMail } from '@adonisjs/mail'

/**
 * The one place the application sends email from (plan §8).
 *
 * No controller calls `mail` directly. That indirection is what lets the
 * delivery strategy change without touching a single call site — which is
 * exactly what happens in M3, when this starts dispatching a `SendMailJob`
 * onto our own durable queue instead of sending inline.
 *
 * Until then a send is synchronous but non-fatal: a signup must not fail
 * because the mail provider is having a bad minute, so a delivery error is
 * logged and swallowed. The user still sees "check your email", and the
 * "resend" action on that screen is the recovery path.
 */
export class MailerService {
  /**
   * Deliver a transactional email.
   *
   * @returns whether the message was handed to the transport
   */
  async send(message: BaseMail): Promise<boolean> {
    try {
      await mail.send(message)
      return true
    } catch (error) {
      /**
       * In tests and development a broken mailer should be loud in the logs
       * but must never take a request down with it.
       */
      logger.error({ err: error, mail: message.constructor.name }, 'failed to send email')

      if (app.inTest) {
        throw error
      }

      return false
    }
  }
}

export default new MailerService()
