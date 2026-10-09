import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import AuditLog from '#models/audit_log'
import settings from '#settings/settings_service'
import WaitingListEntry from '#modules/registration_control/models/waiting_list_entry'
import { createStaff, createWorkspace, queuedMailsTo } from '#tests/helpers'

/**
 * Admin → Waiting list (plan §22.5).
 */
test.group('Waiting list — back-office', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  function entry(
    email: string,
    status: WaitingListEntry['status'] = 'confirmed',
    doubleOptInRequired = true
  ) {
    return WaitingListEntry.create({
      email,
      status,
      doubleOptInRequired,
      confirmedAt: status === 'pending_confirmation' ? null : DateTime.utc(),
      confirmationTokenHash: status === 'pending_confirmation' ? 'a'.repeat(64) : null,
      confirmationExpiresAt:
        status === 'pending_confirmation' ? DateTime.utc().plus({ hours: 48 }) : null,
    })
  }

  test('support and admin can both see the list', async ({ client }) => {
    await entry('jane@example.com')

    for (const role of ['support', 'admin'] as const) {
      const staff = await createStaff({ role })
      const response = await client.get('/admin/waitlist').withGuard('staff').loginAs(staff)

      response.assertStatus(200)
      response.assertTextIncludes('jane@example.com')
    }
  })

  test('a tenant user cannot reach it', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/admin/waitlist').loginAs(user).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/login')
  })

  test('it is in the admin sidebar', async ({ client }) => {
    const support = await createStaff({ role: 'support' })

    const response = await client.get('/admin').withGuard('staff').loginAs(support)

    response.assertTextIncludes('/admin/waitlist')
  })

  test('filters by status, and counts every status', async ({ client, assert }) => {
    const staff = await createStaff()
    await entry('pending@example.com', 'pending_confirmation')
    await entry('confirmed@example.com', 'confirmed')
    await entry('cancelled@example.com', 'cancelled')

    const response = await client
      .get('/admin/waitlist?status=pending_confirmation')
      .withGuard('staff')
      .loginAs(staff)

    const html = response.text()
    assert.include(html, 'pending@example.com')
    assert.notInclude(html, 'confirmed@example.com')
    assert.notInclude(html, 'cancelled@example.com')

    const all = await client.get('/admin/waitlist').withGuard('staff').loginAs(staff)
    for (const email of ['pending@', 'confirmed@', 'cancelled@']) {
      assert.include(all.text(), email)
    }
  })

  test('an unknown status filter shows everything rather than nothing', async ({ client }) => {
    const staff = await createStaff()
    await entry('jane@example.com')

    const response = await client
      .get('/admin/waitlist?status=nonsense')
      .withGuard('staff')
      .loginAs(staff)

    response.assertTextIncludes('jane@example.com')
  })

  test('pages through the list, newest first', async ({ client, assert }) => {
    const staff = await createStaff()

    for (let i = 0; i < 55; i++) {
      const row = await entry(`person${i}@example.com`)
      row.createdAt = DateTime.utc().minus({ minutes: 55 - i })
      await row.save()
    }

    const first = await client.get('/admin/waitlist').withGuard('staff').loginAs(staff)
    assert.include(first.text(), 'person54@example.com')
    assert.notInclude(first.text(), 'person4@example.com')
    first.assertTextIncludes('Showing 1–50 of 55')

    const second = await client.get('/admin/waitlist?page=2').withGuard('staff').loginAs(staff)
    assert.include(second.text(), 'person4@example.com')
    second.assertTextIncludes('Showing 51–55 of 55')
  })

  test('support can cancel an entry, and it is audited', async ({ client, assert }) => {
    const support = await createStaff({ role: 'support' })
    const row = await entry('jane@example.com', 'pending_confirmation')

    const response = await client
      .post(`/admin/waitlist/${row.publicId}/cancel`)
      .withGuard('staff')
      .loginAs(support)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    await row.refresh()
    assert.equal(row.status, 'cancelled')
    assert.isNull(row.confirmationTokenHash, 'the emailed link stops working')

    const audit = await AuditLog.findByOrFail('action', 'waitlist.cancelled')
    assert.equal(audit.actorId, support.id)
    assert.equal(audit.subjectId, row.publicId)
    assert.include(audit.metadata!, { from: 'pending_confirmation', to: 'cancelled' })
  })

  test('mark converted', async ({ client, assert }) => {
    const staff = await createStaff()
    const row = await entry('jane@example.com', 'confirmed')

    await client
      .post(`/admin/waitlist/${row.publicId}/convert`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    await row.refresh()
    assert.equal(row.status, 'converted')
    assert.isNotNull(row.convertedAt)
    assert.exists(await AuditLog.findBy('action', 'waitlist.converted'))
  })

  test('a cancelled entry cannot be marked converted', async ({ client, assert }) => {
    const staff = await createStaff()
    const row = await entry('jane@example.com', 'cancelled')

    const response = await client
      .post(`/admin/waitlist/${row.publicId}/convert`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'A cancelled entry cannot be marked as converted.')
    await row.refresh()
    assert.equal(row.status, 'cancelled')
    assert.isNull(await AuditLog.findBy('action', 'waitlist.converted'), 'a refusal is not audited')
  })

  test('resend queues a fresh confirmation link', async ({ client, assert }) => {
    const staff = await createStaff()
    const row = await entry('jane@example.com', 'pending_confirmation')

    await client
      .post(`/admin/waitlist/${row.publicId}/resend`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    const [queued] = await queuedMailsTo('jane@example.com')
    assert.equal(queued.subject, 'Confirm your place on the waiting list')

    await row.refresh()
    assert.notEqual(row.confirmationTokenHash, 'a'.repeat(64), 'the old link is retired')
    assert.exists(await AuditLog.findBy('action', 'waitlist.resent'))
  })

  test('resend is refused for an entry that has nothing to confirm', async ({ client, assert }) => {
    const staff = await createStaff()
    const row = await entry('jane@example.com', 'confirmed')

    const response = await client
      .post(`/admin/waitlist/${row.publicId}/resend`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage(
      'error',
      'Only an entry waiting for confirmation can be sent the link again.'
    )
    assert.lengthOf(await queuedMailsTo('jane@example.com'), 0)
  })

  test('delete removes the row, and the address can join again', async ({ client, assert }) => {
    const staff = await createStaff()
    const row = await entry('jane@example.com', 'cancelled')

    await client
      .post(`/admin/waitlist/${row.publicId}/delete`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    assert.isNull(await WaitingListEntry.find(row.id))
    const audit = await AuditLog.findByOrFail('action', 'waitlist.deleted')
    assert.include(audit.metadata!, { email: 'jane@example.com', from: 'cancelled', to: null })

    await settings.set('registration_enabled', false)
    await client.post('/waitlist').form({ email: 'jane@example.com' }).withCsrfToken().redirects(0)
    assert.exists(await WaitingListEntry.findBy('email', 'jane@example.com'))
  })

  test('an unknown entry is a flash, not a 500', async ({ client }) => {
    const staff = await createStaff()

    const response = await client
      .post('/admin/waitlist/wle_doesnotexist/cancel')
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertFlashMessage('error', 'That entry no longer exists.')
  })
})
