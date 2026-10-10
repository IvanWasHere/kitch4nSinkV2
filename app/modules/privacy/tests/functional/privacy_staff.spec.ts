import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import drive from '@adonisjs/drive/services/main'

import User from '#models/user'
import AuditLog from '#models/audit_log'
import privacy from '#modules/privacy/services/privacy_service'
import PrivacyRequest from '#modules/privacy/models/privacy_request'
import {
  addMember,
  createStaff,
  createWorkspace,
  queuedMailsTo,
  runQueue,
  TEST_PASSWORD,
} from '#tests/helpers'

/**
 * Privacy requests staff start on somebody's behalf (plan §22.8) — the
 * request arrived by email or ticket, not through the person's own screen.
 */
test.group('Privacy — started by staff', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  async function startExport(client: any, staff: any, user: User) {
    return client
      .post('/admin/privacy/exports')
      .withGuard('staff')
      .loginAs(staff)
      .form({ user: user.publicId })
      .withCsrfToken()
      .redirects(0)
  }

  test('the users screen offers both to an admin, and neither to support', async ({
    client,
    assert,
  }) => {
    await createWorkspace({ email: 'jane@example.com' })
    const admin = await createStaff({ role: 'admin' })
    const support = await createStaff({ role: 'support' })

    const asAdmin = await client.get('/admin/users').withGuard('staff').loginAs(admin)
    asAdmin.assertTextIncludes('Export data')
    asAdmin.assertTextIncludes('Delete account')

    const asSupport = await client.get('/admin/users').withGuard('staff').loginAs(support)
    assert.notInclude(asSupport.text(), 'Export data')
    assert.notInclude(asSupport.text(), 'Delete account')
  })

  test('an admin export is built for the admin, not the person', async ({ client, assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const admin = await createStaff({ role: 'admin' })

    const response = await startExport(client, admin, user)

    const request = await PrivacyRequest.findByOrFail('user_id', user.id)
    response.assertHeader('location', `/admin/privacy/${request.publicId}`)
    assert.equal(request.requestedByStaffId, admin.id)
    assert.exists(await AuditLog.findBy('action', 'privacy.export.started_by_staff'))
    assert.equal(request.status, 'completed', 'built on the click, with no worker running')
    response.assertFlashMessage('success', 'The export is ready.')

    /**
     * The job queued as the safety net finds nothing left to do.
     */
    await runQueue('default')
    await request.refresh()
    assert.equal(request.status, 'completed')
    assert.lengthOf(await AuditLog.query().where('action', 'privacy.export.generated'), 1)

    const mails = await queuedMailsTo('jane@example.com')
    assert.isFalse(
      mails.some((one) => one.subject === 'Your data export is ready'),
      'the person is not emailed'
    )

    const ownPage = await client.get('/settings/privacy').loginAs(user)
    assert.notInclude(ownPage.text(), 'Your exports', 'not on their own screen')

    const theirDownload = await client
      .get(`/settings/privacy/exports/${request.publicId}`)
      .loginAs(user)
      .redirects(0)
    theirDownload.assertStatus(404)
  })

  test('the admin downloads it through a short-lived, audited link', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const admin = await createStaff({ role: 'admin' })
    await startExport(client, admin, user)
    await runQueue('default')
    const request = await PrivacyRequest.findByOrFail('user_id', user.id)

    const page = await client
      .get(`/admin/privacy/${request.publicId}`)
      .withGuard('staff')
      .loginAs(admin)
    page.assertTextIncludes('Download export')

    const download = await client
      .get(`/admin/privacy/${request.publicId}/download`)
      .withGuard('staff')
      .loginAs(admin)
      .redirects(0)

    download.assertStatus(302)
    assert.include(download.header('location'), 'signature=')
    const entry = await AuditLog.query()
      .where('action', 'privacy.export.downloaded')
      .where('actor_type', 'staff')
      .firstOrFail()
    assert.equal(entry.actorId, admin.id)
  })

  test('every row on the privacy requests screen has a generate button for an admin', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const admin = await createStaff({ role: 'admin' })
    const support = await createStaff({ role: 'support' })
    await privacy.requestExport(user)

    const asAdmin = await client.get('/admin/privacy').withGuard('staff').loginAs(admin)
    asAdmin.assertTextIncludes('Generate export')
    assert.include(asAdmin.text(), `value="${user.publicId}"`)
    const asSupport = await client.get('/admin/privacy').withGuard('staff').loginAs(support)
    assert.notInclude(asSupport.text(), 'Generate export')

    /**
     * Their own request is built first, and emails them. The admin's click
     * must not send a second one.
     */
    await runQueue('default')
    const ready = async () => {
      const mails = await queuedMailsTo('jane@example.com')
      return mails.filter((one) => one.subject === 'Your data export is ready').length
    }
    const before = await ready()

    await startExport(client, admin, user)
    await runQueue('default')

    const started = await PrivacyRequest.query().whereNotNull('requested_by_staff_id').firstOrFail()
    assert.equal(started.status, 'completed')
    assert.equal(await ready(), before, 'the person is not emailed')

    /**
     * And the button is now a link to the report, on every row of theirs.
     */
    const after = await client.get('/admin/privacy').withGuard('staff').loginAs(admin)
    after.assertTextIncludes('View report')
    assert.include(after.text(), `href="/admin/privacy/${started.publicId}"`)
    assert.notInclude(after.text(), 'Generate export')
    const supportAfter = await client.get('/admin/privacy').withGuard('staff').loginAs(support)
    assert.notInclude(supportAfter.text(), 'View report')
  })

  test('the report page shows data.json to an admin, audited, and never to support', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const admin = await createStaff({ role: 'admin' })
    const support = await createStaff({ role: 'support' })

    await startExport(client, admin, user)
    await runQueue('default')
    const request = await PrivacyRequest.findByOrFail('user_id', user.id)

    const asAdmin = await client
      .get(`/admin/privacy/${request.publicId}`)
      .withGuard('staff')
      .loginAs(admin)
    asAdmin.assertTextIncludes('payload-dump')
    asAdmin.assertTextIncludes('jane@example.com')
    assert.exists(await AuditLog.findBy('action', 'privacy.export.viewed'))

    const asSupport = await client
      .get(`/admin/privacy/${request.publicId}`)
      .withGuard('staff')
      .loginAs(support)
    assert.notInclude(asSupport.text(), 'payload-dump')
    assert.lengthOf(await AuditLog.query().where('action', 'privacy.export.viewed'), 1)

    /**
     * The person's own export keeps no readable copy, for anybody.
     */
    const own = await privacy.requestExport(user)
    await runQueue('default')
    const ownPage = await client
      .get(`/admin/privacy/${own.request.publicId}`)
      .withGuard('staff')
      .loginAs(admin)
    assert.notInclude(ownPage.text(), 'payload-dump')

    /**
     * And the copy goes when the archive does.
     */
    await request.merge({ exportExpiresAt: request.exportExpiresAt!.minus({ days: 30 }) }).save()
    await privacy.purgeExpired()
    assert.isFalse(await drive.use('private').exists(`privacy/${request.publicId}.json`))
  })

  test('support can neither start nor download one', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const admin = await createStaff({ role: 'admin' })
    const support = await createStaff({ role: 'support' })

    await startExport(client, support, user)
    assert.lengthOf(await PrivacyRequest.all(), 0)

    await startExport(client, admin, user)
    await runQueue('default')
    const request = await PrivacyRequest.firstOrFail()

    const download = await client
      .get(`/admin/privacy/${request.publicId}/download`)
      .withGuard('staff')
      .loginAs(support)
      .redirects(0)
    download.assertStatus(403)
  })

  /**
   * The line the earlier design drew still holds for the person's own
   * exports: an admin cannot download what the person asked for.
   */
  test("a person's own export is never downloadable by staff", async ({ client }) => {
    const { user } = await createWorkspace()
    const admin = await createStaff({ role: 'admin' })
    const { request } = await privacy.requestExport(user)
    await runQueue('default')

    const download = await client
      .get(`/admin/privacy/${request.publicId}/download`)
      .withGuard('staff')
      .loginAs(admin)
      .redirects(0)

    download.assertStatus(404)
  })

  test("a staff export does not block the person's own, or the other way round", async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace()
    const admin = await createStaff({ role: 'admin' })

    await startExport(client, admin, user)
    const own = await privacy.requestExport(user)

    assert.isTrue(own.created)
    assert.lengthOf(await PrivacyRequest.query().where('user_id', user.id), 2)
  })

  test('the deletion page shows what will happen before asking', async ({ client }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const admin = await createStaff({ role: 'admin' })

    const page = await client
      .get(`/admin/privacy/deletions/new?user=${user.publicId}`)
      .withGuard('staff')
      .loginAs(admin)

    page.assertStatus(200)
    page.assertTextIncludes('Delete jane@example.com')
    page.assertTextIncludes('They are the last member of their workspace')
    page.assertTextIncludes('Type jane@example.com to confirm')
  })

  test('support cannot reach it', async ({ client }) => {
    const { user } = await createWorkspace()
    const support = await createStaff({ role: 'support' })

    const page = await client
      .get(`/admin/privacy/deletions/new?user=${user.publicId}`)
      .withGuard('staff')
      .loginAs(support)

    page.assertStatus(403)
  })

  test('a mistyped address deletes nothing', async ({ client, assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const admin = await createStaff({ role: 'admin' })

    const response = await client
      .post('/admin/privacy/deletions')
      .withGuard('staff')
      .loginAs(admin)
      .form({ user: user.publicId, reason: 'Ticket tkt_123', confirmEmail: 'jane@example.org' })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'The address you typed does not match this account.')
    assert.lengthOf(await PrivacyRequest.all(), 0)
  })

  test('a confirmed admin deletion runs at once, with the reason recorded', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const admin = await createStaff({ role: 'admin' })

    const response = await client
      .post('/admin/privacy/deletions')
      .withGuard('staff')
      .loginAs(admin)
      .form({ user: user.publicId, reason: 'Ticket tkt_123', confirmEmail: 'Jane@Example.com' })
      .withCsrfToken()
      .redirects(0)

    const request = await PrivacyRequest.findByOrFail('user_id', user.id)
    response.assertHeader('location', `/admin/privacy/${request.publicId}`)
    assert.equal(request.status, 'completed', 'deleted on the click, with no worker running')
    assert.equal(request.staffNote, 'Ticket tkt_123')
    assert.equal(request.requestedByStaffId, admin.id)

    await runQueue('default')
    await request.refresh()
    assert.equal(request.status, 'completed')

    const row = await User.findOrFail(user.id)
    assert.equal(row.email, `email${user.id}@deleteduser.com`)

    const entry = await AuditLog.findByOrFail('action', 'privacy.deletion.started_by_staff')
    assert.include(entry.metadata!, { reason: 'Ticket tkt_123' })

    const goodbye = await queuedMailsTo('jane@example.com')
    assert.isTrue(goodbye.some((one) => one.subject === 'Your account has been deleted'))
  })

  test('an owner with members can be deleted, and the page says who goes with them', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    const sam = await addMember(organization, user, 'sam@example.com')
    const admin = await createStaff({ role: 'admin' })

    const page = await client
      .get(`/admin/privacy/deletions/new?user=${user.publicId}`)
      .withGuard('staff')
      .loginAs(admin)
    page.assertTextIncludes('Every other member of the workspace is deleted the same way')
    page.assertTextIncludes('Delete this account')

    await client
      .post('/admin/privacy/deletions')
      .withGuard('staff')
      .loginAs(admin)
      .form({ user: user.publicId, reason: 'Ticket tkt_123', confirmEmail: user.email })
      .withCsrfToken()
      .redirects(0)
    await runQueue('default')

    const row = await User.findOrFail(sam.id)
    assert.equal(row.email, `email${sam.id}@deleteduser.com`)
  })

  test('a deletion already in progress is pointed to, not duplicated', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace()
    await client
      .post('/settings/privacy/deletion')
      .loginAs(user)
      .form({ password: TEST_PASSWORD, understood: '1' })
      .withCsrfToken()
    const admin = await createStaff({ role: 'admin' })

    const page = await client
      .get(`/admin/privacy/deletions/new?user=${user.publicId}`)
      .withGuard('staff')
      .loginAs(admin)
    page.assertTextIncludes('There is already a deletion request for this account')

    await client
      .post('/admin/privacy/deletions')
      .withGuard('staff')
      .loginAs(admin)
      .form({ user: user.publicId, reason: 'Ticket tkt_123', confirmEmail: user.email })
      .withCsrfToken()
      .redirects(0)

    assert.lengthOf(await PrivacyRequest.query().where('type', 'deletion'), 1)
  })
})
