import { randomUUID } from 'node:crypto'
import app from '@adonisjs/core/services/app'
import mail from '@adonisjs/mail/services/main'
import logger from '@adonisjs/core/services/logger'
import type { BaseMail } from '@adonisjs/mail'

import env from '#start/env'
import queue from '#queue/queue_service'
import sendMailJob, { type SendMailPayload } from '#queue/jobs/send_mail_job'

/**
 * The one place the application sends email from (plan §8).
 *
 * No controller calls `mail` directly, and nothing sends inline: a message is
 * rendered here and handed to the durable queue, so a provider outage delays
 * a verification email rather than losing it, and a crash between "user
 * created" and "email sent" leaves a job that will still run.
 *
 * Rendering before queueing rather than in the worker is deliberate. The
 * worker never re-reads the models the email was about, so a row deleted in
 * between cannot crash delivery, and the words sent are the words that were
 * true when the action happened.
 */
export class MailerService {
  /**
   * Render a message and put it on the queue.
   *
   * @returns the id of the queued job, or null when the message could not be
   *   rendered — a broken template must not take a signup down with it.
   */
  async send(message: BaseMail): Promise<number | null> {
    try {
      /**
       * Renders the Edge templates into the message and applies the
       * from-address and subject the mail class declares.
       */
      await message.buildWithContents()

      const compiled = message.message.toJSON() as SendMailPayload['compiled']

      /**
       * `sendCompiled` sends exactly what it is given, so the from-address
       * that `send` would have filled in from config never gets applied.
       * Owning it here is what §8 asks of this class anyway — one place
       * decides who the mail is from, rather than every mail class repeating
       * it or, worse, nodemailer's `app@yourdomain.com` placeholder going out
       * to a customer.
       */
      if (!compiled.message.from) {
        compiled.message.from = {
          address: env.get('MAIL_FROM_ADDRESS', 'onboarding@resend.dev'),
          name: env.get('MAIL_FROM_NAME', env.get('APP_NAME', 'Acme')),
        }
      }

      const payload: SendMailPayload = {
        mailer: env.get('MAIL_MAILER', 'smtp'),
        /**
         * Stable across every retry of this job, which is what makes an
         * at-least-once queue safe to point at a mail provider (plan §8).
         */
        idempotencyKey: randomUUID(),
        compiled,
      }

      const job = await queue.dispatch(sendMailJob, payload)

      logger.debug({ jobId: job.id, mail: message.constructor.name }, 'queued email')

      return job.id
    } catch (error) {
      logger.error(
        { err: error, mail: message.constructor.name },
        'failed to render or queue an email'
      )

      /**
       * Loud in tests, survivable in production: a template that throws is a
       * bug worth failing a test over, but it must not turn a successful
       * signup into a 500.
       */
      if (app.inTest) {
        throw error
      }

      return null
    }
  }

  /**
   * Render and send immediately, bypassing the queue.
   *
   * Only for a caller that has no worker — the `staff:create` command, say.
   * Everything reached over HTTP should use `send`.
   */
  async sendNow(message: BaseMail): Promise<void> {
    await mail.send(message)
  }
}

export default new MailerService()
