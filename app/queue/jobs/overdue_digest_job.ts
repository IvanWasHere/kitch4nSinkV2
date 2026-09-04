import logger from '@adonisjs/core/services/logger'

import User from '#models/user'
import Organization from '#models/organization'
import mailer from '#mail/mailer_service'
import todos from '#todos/todo_service'
import OverdueDigestNotification from '#mail/mails/overdue_digest_notification'
import type { JobHandler } from '#queue/contracts'

/**
 * Emails each assignee a daily summary of their overdue todos (plan §5.6) —
 * the second real consumer of the queue and the mailer.
 *
 * Only people who have something overdue are emailed: a daily "nothing is
 * overdue" message is the fastest way to teach someone to filter you out.
 *
 * At-least-once delivery means this can run twice in a day. Sending the same
 * digest twice is annoying rather than harmful, which is the right side of
 * that trade for a reminder — unlike, say, a payment.
 */
class OverdueDigestJob implements JobHandler {
  readonly name = 'overdue_digest'

  /**
   * Runs on the default queue, not `mail`. It is a scan over every user that
   * *produces* email; putting it on the same queue as the sends would let one
   * nightly sweep sit in front of somebody's password reset. Separating a slow
   * queue from a latency-sensitive one is the whole reason there are two.
   */
  readonly queue = 'default'

  async handle() {
    const users = await User.query().whereNull('deleted_at').whereNotNull('email_verified_at')

    let sent = 0
    let failed = 0

    for (const user of users) {
      const overdue = await todos.overdueFor(user)

      if (overdue.length === 0) {
        continue
      }

      const organization = await Organization.query()
        .where('id', user.organizationId)
        .whereNull('deleted_at')
        .first()

      if (!organization) {
        continue
      }

      const queued = await mailer.send(new OverdueDigestNotification(user, organization, overdue))

      if (queued === null) {
        failed++
        continue
      }

      sent++
    }

    logger.info({ recipients: sent, failed }, 'queued overdue digests')

    /**
     * MailerService swallows a render failure so a broken template cannot
     * take a signup down with it. In a worker that trade is wrong: a digest
     * that silently emailed nobody would look like a clean run forever. Fail
     * the job instead, so it lands on the admin queue screen with its error.
     */
    if (failed > 0) {
      throw new Error(`${failed} overdue digest(s) could not be rendered or queued`)
    }
  }
}

export default new OverdueDigestJob()
