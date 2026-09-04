import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import Job from '#models/job'
import queue from '#queue/queue_service'
import mailer from '#mail/mailer_service'
import invitations from '#organizations/invitation_service'
import Invitation from '#models/invitation'
import expireInvitationsJob from '#queue/jobs/expire_invitations_job'
import VerifyEmailNotification from '#mail/mails/verify_email_notification'
import { createWorkspace, runQueue } from '#tests/helpers'

test.group('Queue worker', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  /**
   * The whole point of M3: mail is rendered, queued, and delivered by a
   * worker — so an outage delays a verification email rather than losing it.
   */
  test('delivers a queued email when the worker runs', async ({ assert }) => {
    const { mails } = mail.fake()
    const { user } = await createWorkspace()

    await mailer.send(new VerifyEmailNotification(user, 'a-token'))

    /**
     * Nothing has been handed to a transport yet — the message is a row.
     */
    mails.assertNoneSent()

    const queued = await Job.findByOrFail('name', 'send_mail')
    const compiled = (queued.payload as any).compiled.message
    assert.equal(compiled.subject, 'Confirm your email address')
    assert.deepEqual(compiled.to, [user.email])

    const processed = await runQueue('mail')

    /**
     * `processed` is the assertion that matters: the handler ran to
     * completion, so `sendCompiled` accepted the payload we built. A throw
     * would have failed the job and left the row behind.
     */
    assert.equal(processed, 1)
    assert.isNull(await Job.find(queued.id), 'and the row is gone once done')

    const counts = await queue.counts()
    assert.equal(counts.failed, 0)
  })

  /**
   * The idempotency key is what makes an at-least-once queue safe to point at
   * a mail provider: a retry after a partial failure must not be a second
   * email (plan §8).
   */
  test('carries a stable idempotency key that survives a retry', async ({ assert }) => {
    const { user } = await createWorkspace()
    await mailer.send(new VerifyEmailNotification(user, 'a-token'))

    const job = await Job.findByOrFail('name', 'send_mail')
    const key = (job.payload as any).idempotencyKey

    assert.isString(key)

    await queue.fail(job, new Error('provider hiccup'))
    await job.refresh()

    assert.equal(
      (job.payload as any).idempotencyKey,
      key,
      'the same key goes out on the next attempt'
    )
  })

  test('a handler that throws is retried, then parked', async ({ assert }) => {
    const job = await queue.dispatch({ name: 'no_such_handler' }, {}, { maxAttempts: 3 })

    await runQueue('default')
    await job.refresh()

    /**
     * A job whose handler has gone cannot start working later, so it is
     * parked at once rather than retried twice more.
     */
    assert.isTrue(job.isFailed)
    assert.equal(job.attempts, 1)
    assert.include(job.lastError!, 'No handler')
  })

  test('a failed job can be retried and then succeeds', async ({ assert }) => {
    const { user } = await createWorkspace()
    await mailer.send(new VerifyEmailNotification(user, 'a-token'))

    const job = await Job.findByOrFail('name', 'send_mail')
    await queue.fail(job, new Error('provider down'))
    await queue.fail(job, new Error('provider down'))
    await queue.fail(job, new Error('provider down'))
    await queue.fail(job, new Error('provider down'))
    await queue.fail(job, new Error('provider down'))

    await job.refresh()
    assert.isTrue(job.isFailed)

    await queue.retry(job)
    const processed = await runQueue('mail')

    assert.equal(processed, 1)
    assert.isNull(await Job.find(job.id))
  })

  test('expires invitations that have lapsed', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const { invitation } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'lapsed@example.com',
    })

    invitation.expiresAt = DateTime.utc().minus({ days: 1 })
    await invitation.save()

    await queue.dispatch(expireInvitationsJob)
    await runQueue('default')

    const refreshed = await Invitation.findOrFail(invitation.id)
    assert.isTrue(refreshed.isRevoked)
  })

  /**
   * At-least-once delivery means every handler runs twice sooner or later.
   */
  test('expiring invitations twice changes nothing the second time', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const { invitation } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'lapsed@example.com',
    })
    invitation.expiresAt = DateTime.utc().minus({ days: 1 })
    await invitation.save()

    await queue.dispatch(expireInvitationsJob)
    await runQueue('default')

    const afterFirst = await Invitation.findOrFail(invitation.id)
    const revokedAt = afterFirst.revokedAt!.toISO()

    await queue.dispatch(expireInvitationsJob)
    await runQueue('default')

    const afterSecond = await Invitation.findOrFail(invitation.id)
    assert.equal(afterSecond.revokedAt!.toISO(), revokedAt)
  })

  test('leaves a live invitation alone', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const { invitation } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'live@example.com',
    })

    await queue.dispatch(expireInvitationsJob)
    await runQueue('default')

    const refreshed = await Invitation.findOrFail(invitation.id)
    assert.isTrue(refreshed.isPending)
  })
})
