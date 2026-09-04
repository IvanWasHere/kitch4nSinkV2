import mail from '@adonisjs/mail/services/main'

import type { JobContext, JobHandler } from '#queue/contracts'

/**
 * The shape `MailerService` puts on the queue: a message that has already
 * been rendered.
 *
 * Rendering happens at dispatch time, not here, and that is the important
 * part. The worker never re-reads the models the email was about, so an
 * invitation revoked between dispatch and delivery cannot change the words in
 * an email that was already promised, and a template that needs a user who
 * has since been deleted cannot crash the queue.
 */
export interface SendMailPayload {
  mailer?: 'smtp' | 'resend'
  idempotencyKey: string
  compiled: {
    message: Record<string, any>
    views: Record<string, any>
  }
}

class SendMailJob implements JobHandler<SendMailPayload> {
  readonly name = 'send_mail'
  readonly queue = 'mail'

  /**
   * Resend allows roughly two requests a second and answers 429 above that.
   * A 429 is a normal, retryable outcome here rather than an error worth
   * paging anyone about, which is why the queue's exponential backoff is the
   * whole rate-limit strategy (plan §8).
   */
  readonly maxAttempts = 5

  async handle(payload: SendMailPayload, { job }: JobContext) {
    const mailer = payload.mailer ? mail.use(payload.mailer) : mail.use()

    /**
     * The same key on every attempt, so an at-least-once retry after a
     * partial failure is not a second email (plan §8). It travels as a
     * header; transports that do not understand it ignore it.
     */
    payload.compiled.message.headers = {
      ...(payload.compiled.message.headers ?? {}),
      'Idempotency-Key': payload.idempotencyKey,
      'X-Job-Id': String(job.id),
    }

    await mailer.sendCompiled(payload.compiled as any)
  }
}

export default new SendMailJob()
