import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import AuditLog from '#models/audit_log'
import privacy from '#modules/privacy/services/privacy_service'
import PrivacyRequest from '#modules/privacy/models/privacy_request'
import { createStaff, createWorkspace, runQueue } from '#tests/helpers'

/**
 * Admin → Privacy requests (plan §22.8.3).
 */
test.group('Privacy — back-office', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  async function failedExport() {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const { request } = await privacy.requestExport(user)
    request.merge({ status: 'failed', failureReason: 'The archive could not be built.' })
    await request.save()
    return { user, request }
  }

  test('support and admin both see every request', async ({ client }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const { request } = await privacy.requestExport(user)

    for (const role of ['support', 'admin'] as const) {
      const staff = await createStaff({ role })
      const response = await client.get('/admin/privacy').withGuard('staff').loginAs(staff)

      response.assertStatus(200)
      response.assertTextIncludes(request.publicId)
      response.assertTextIncludes('jane@example.com')
    }
  })

  test('it is in the admin sidebar', async ({ client }) => {
    const staff = await createStaff({ role: 'support' })

    const response = await client.get('/admin').withGuard('staff').loginAs(staff)

    response.assertTextIncludes('/admin/privacy')
  })

  test('a tenant user cannot reach it', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/admin/privacy').loginAs(user).redirects(0)

    response.assertHeader('location', '/admin/login')
  })

  test('filters narrow the list and count what they would show', async ({ client, assert }) => {
    const { user: jane } = await createWorkspace({ email: 'jane@example.com' })
    const { user: sam } = await createWorkspace({ email: 'sam@example.com' })
    await privacy.requestExport(jane)
    const { request: failed } = await privacy.requestExport(sam)
    failed.status = 'failed'
    await failed.save()

    const staff = await createStaff()
    const only = await client.get('/admin/privacy?filter=failed').withGuard('staff').loginAs(staff)

    assert.include(only.text(), 'sam@example.com')
    assert.notInclude(only.text(), 'jane@example.com')

    const all = await client.get('/admin/privacy').withGuard('staff').loginAs(staff)
    assert.match(all.text(), /Exports\s*<span class="pill-count">2</)
    assert.match(all.text(), /Failed\s*<span class="pill-count">1</)
  })

  test('the detail page shows the request and its history, and no download', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    await client.post('/settings/privacy/exports').loginAs(user).withCsrfToken()
    await runQueue('default')
    const request = await PrivacyRequest.findByOrFail('user_id', user.id)

    const staff = await createStaff()
    const response = await client
      .get(`/admin/privacy/${request.publicId}`)
      .withGuard('staff')
      .loginAs(staff)

    response.assertStatus(200)
    response.assertTextIncludes('jane@example.com')
    response.assertTextIncludes('privacy.export.requested')
    response.assertTextIncludes('privacy.export.generated')
    assert.notInclude(response.text(), '/settings/privacy/exports/')
    assert.notInclude(response.text(), 'signature=')
  })

  test('support can retry a failed export, and it is rebuilt and audited', async ({
    client,
    assert,
  }) => {
    const { request } = await failedExport()
    const support = await createStaff({ role: 'support' })

    const response = await client
      .post(`/admin/privacy/${request.publicId}/retry`)
      .withGuard('staff')
      .loginAs(support)
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', `/admin/privacy/${request.publicId}`)
    await request.refresh()
    assert.equal(request.status, 'completed', 'rebuilt on the click, with no worker running')
    assert.isNull(request.failureReason)

    const entry = await AuditLog.findByOrFail('action', 'privacy.export.retried')
    assert.equal(entry.actorId, support.id)

    await runQueue('default')
    await request.refresh()
    assert.equal(request.status, 'completed')
  })

  test('only a failed export can be retried', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const { request } = await privacy.requestExport(user)
    const staff = await createStaff()

    const response = await client
      .post(`/admin/privacy/${request.publicId}/retry`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'Only a failed export can be retried.')
    assert.isNull(await AuditLog.findBy('action', 'privacy.export.retried'))
  })

  test('a failed export for an account that has gone cannot be retried', async ({ client }) => {
    const { user, request } = await failedExport()
    user.deletedAt = DateTime.utc()
    await user.save()
    const staff = await createStaff()

    const response = await client
      .post(`/admin/privacy/${request.publicId}/retry`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage(
      'error',
      'That account no longer exists, so there is nothing to export.'
    )
  })
})
