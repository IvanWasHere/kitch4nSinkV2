import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import queue from '#queue/queue_service'
import AuditLog from '#models/audit_log'
import WaitingListEntry from '#modules/registration_control/models/waiting_list_entry'
import markWaitingListConvertedJob from '#modules/registration_control/jobs/mark_waiting_list_converted_job'
import { createWorkspace, runQueue } from '#tests/helpers'

/**
 * The nightly sweep that marks an entry converted once its address has an
 * account (plan §22.5).
 */
test.group('Waiting list — conversion job', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  function entry(email: string, status: WaitingListEntry['status']) {
    return WaitingListEntry.create({
      email,
      status,
      doubleOptInRequired: true,
      confirmedAt: status === 'confirmed' ? DateTime.utc() : null,
      confirmationTokenHash: status === 'pending_confirmation' ? 'a'.repeat(64) : null,
    })
  }

  async function sweep() {
    await queue.dispatch(markWaitingListConvertedJob)
    await runQueue('default')
  }

  test('a confirmed entry whose address now has an account is converted', async ({ assert }) => {
    const row = await entry('jane@example.com', 'confirmed')
    await createWorkspace({ email: 'jane@example.com' })

    await sweep()

    await row.refresh()
    assert.equal(row.status, 'converted')
    assert.isNotNull(row.convertedAt)

    const audit = await AuditLog.findByOrFail('action', 'waitlist.converted')
    assert.equal(audit.actorType, 'system')
    assert.include(audit.metadata!, { from: 'confirmed', reason: 'account_created' })
  })

  test('a pending entry is converted too, and its link stops working', async ({ assert }) => {
    const row = await entry('jane@example.com', 'pending_confirmation')
    await createWorkspace({ email: 'jane@example.com' })

    await sweep()

    await row.refresh()
    assert.equal(row.status, 'converted')
    assert.isNull(row.confirmationTokenHash)
  })

  test('entries without an account, and cancelled ones, are left alone', async ({ assert }) => {
    const waiting = await entry('waiting@example.com', 'confirmed')
    const cancelled = await entry('cancelled@example.com', 'cancelled')
    await createWorkspace({ email: 'cancelled@example.com' })

    await sweep()

    await waiting.refresh()
    await cancelled.refresh()
    assert.equal(waiting.status, 'confirmed')
    assert.equal(cancelled.status, 'cancelled', 'a staff cancel is not overruled')
    assert.lengthOf(await AuditLog.query().where('action', 'waitlist.converted'), 0)
  })

  test('running it twice converts once', async ({ assert }) => {
    const row = await entry('jane@example.com', 'confirmed')
    await createWorkspace({ email: 'jane@example.com' })

    await sweep()
    await row.refresh()
    const convertedAt = row.convertedAt?.toMillis()

    await sweep()

    await row.refresh()
    assert.equal(row.convertedAt?.toMillis(), convertedAt)
    assert.lengthOf(await AuditLog.query().where('action', 'waitlist.converted'), 1)
  })
})
