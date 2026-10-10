import { inflateRawSync } from 'node:zlib'
import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import drive from '@adonisjs/drive/services/main'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import File from '#models/file'
import ApiKey from '#models/api_key'
import AuditLog from '#models/audit_log'
import SocialAccount from '#models/social_account'
import queue from '#queue/queue_service'
import storage from '#storage/disk_storage'
import support from '#support/support_service'
import privacy from '#modules/privacy/services/privacy_service'
import PrivacyRequest from '#modules/privacy/models/privacy_request'
import purgeJob from '#modules/privacy/jobs/purge_privacy_exports_job'
import { IMPERSONATION_SESSION_KEY } from '#middleware/impersonation'
import {
  addMember,
  createList,
  createStaff,
  createWorkspace,
  queuedMailsTo,
  runQueue,
} from '#tests/helpers'

/**
 * Data exports (plan §22.8.1).
 */

/**
 * Read a zip without a dependency: walk the central directory, then inflate
 * each entry. Enough for what `yazl` writes — deflate or stored, no zip64.
 */
function unzip(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let end = buffer.length - 22

  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) {
    end--
  }

  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)

  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)

    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(start, start + compressedSize)

    entries.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw))
    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

async function archiveFor(request: PrivacyRequest) {
  const bytes = await drive.use('private').getBytes(request.exportKey!)
  return unzip(Buffer.from(bytes))
}

async function exportFor(user: Awaited<ReturnType<typeof createWorkspace>>['user']) {
  const { request } = await privacy.requestExport(user)
  await runQueue('default')
  await request.refresh()
  return request
}

test.group('Privacy — data export', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  test('the settings screen offers an export, and is in the settings nav', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/settings/privacy').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('Download your data')
    response.assertTextIncludes('href="/settings/privacy"')
  })

  test('asking queues one export, and asking again does not queue a second', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace()

    for (let i = 0; i < 2; i++) {
      const response = await client
        .post('/settings/privacy/exports')
        .loginAs(user)
        .withCsrfToken()
        .redirects(0)
      response.assertHeader('location', '/settings/privacy')
    }

    const requests = await PrivacyRequest.query().where('user_id', user.id)
    assert.lengthOf(requests, 1)
    assert.equal(requests[0].status, 'requested')
    assert.match(requests[0].publicId, /^prq_/)
    assert.lengthOf(await AuditLog.query().where('action', 'privacy.export.requested'), 1)
  })

  test('the job builds the archive, stores it privately, and emails the owner', async ({
    assert,
  }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })

    const request = await exportFor(user)

    assert.equal(request.status, 'completed')
    assert.isTrue(request.isDownloadable)
    assert.isAbove(request.exportSizeBytes!, 0)
    assert.equal(request.exportKey, `privacy/${request.publicId}.zip`)
    assert.isTrue(await storage.exists({ disk: 'private', key: request.exportKey! }))
    assert.isFalse(await drive.use('public').exists(request.exportKey!), 'never on the public disk')

    const hours = request.exportExpiresAt!.diff(request.completedAt!, 'hours').hours
    assert.approximately(hours, 48, 0.1)

    const [sent] = await queuedMailsTo('jane@example.com').then((mails) =>
      mails.filter((one) => one.subject === 'Your data export is ready')
    )
    assert.exists(sent)
    assert.include(sent.html, '/settings/privacy')
    assert.notInclude(sent.html, request.exportKey!, 'the email links to the screen, not the file')

    assert.lengthOf(await AuditLog.query().where('action', 'privacy.export.generated'), 1)
  })

  test('the archive holds every section, a README and the uploaded files', async ({ assert }) => {
    const { user, organization } = await createWorkspace({ email: 'jane@example.com' })
    await createList(organization, user, 'Launch', ['Write the post'])
    await support.open(organization, user, { subject: 'Help please', body: 'It broke.' })

    await drive.use('private').put('test/notes.txt', 'my own notes')
    const upload = await File.create({
      organizationId: organization.id,
      userId: user.id,
      disk: 'private',
      key: 'test/notes.txt',
      originalName: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      visibility: 'private',
      checksum: 'x',
    })

    const archive = await archiveFor(await exportFor(user))
    const data = JSON.parse(archive.get('data.json')!.toString()).data

    assert.equal(data.account.email, 'jane@example.com')
    assert.equal(data.workspace.name, organization.name)
    assert.isTrue(data.workspace.youOwnIt)
    assert.equal(data.listsAndTodos.listsCreated[0].name, 'Launch')
    assert.equal(data.listsAndTodos.todos[0].title, 'Write the post')
    assert.equal(data.supportTickets[0].subject, 'Help please')
    assert.equal(data.supportTickets[0].messages[0].body, 'It broke.')

    const fileName = `files/${upload.publicId}-notes.txt`
    assert.equal(data.files[0].inArchiveAs, fileName)
    assert.equal(archive.get(fileName)!.toString(), 'my own notes')

    const readme = archive.get('README.txt')!.toString()
    assert.include(readme, 'listsAndTodos')
    assert.include(readme, 'Not included')
  })

  /**
   * The test that matters most here. Real secret values are planted in every
   * place one could live, and the whole archive — JSON, README and files —
   * is searched for them.
   */
  test('no credential reaches the archive', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    user.twoFactorSecret = 'PLANTED-TOTP-SECRET'
    user.twoFactorRecoveryCodes = ['PLANTED-RECOVERY-CODE']
    user.twoFactorConfirmedAt = DateTime.utc()
    await user.save()

    await SocialAccount.create({
      userId: user.id,
      provider: 'github',
      providerUserId: '42',
      providerEmail: user.email,
      accessToken: 'PLANTED-ACCESS-TOKEN',
    })

    await ApiKey.create({
      organizationId: organization.id,
      name: 'Nightly',
      prefix: 'sk_live_ab',
      keyHash: 'PLANTED-KEY-HASH',
      scopes: ['members:read'],
      createdByUserId: user.id,
    })

    const archive = await archiveFor(await exportFor(user))
    const everything = [...archive.values()].map((bytes) => bytes.toString()).join('\n')

    for (const secret of [
      'PLANTED-TOTP-SECRET',
      'PLANTED-RECOVERY-CODE',
      'PLANTED-ACCESS-TOKEN',
      'PLANTED-KEY-HASH',
      user.password!,
    ]) {
      assert.notInclude(everything, secret)
    }

    const data = JSON.parse(archive.get('data.json')!.toString()).data
    assert.isTrue(data.account.twoFactorEnabled, 'that it is on is exported; the secret is not')
    assert.equal(data.apiKeysCreated[0].prefix, 'sk_live_ab')
  })

  test("a colleague's data stays out", async ({ assert }) => {
    const { user, organization } = await createWorkspace({ email: 'jane@example.com' })
    const colleague = await addMember(organization, user, 'sam@example.com')
    await createList(organization, colleague, 'Sam only', ['Sam todo'])

    const archive = await archiveFor(await exportFor(user))
    const everything = archive.get('data.json')!.toString()

    assert.notInclude(everything, 'sam@example.com')
    assert.notInclude(everything, 'Sam only')
    assert.notInclude(everything, 'Sam todo')
  })

  test('the owner can download it; the link is short-lived and audited', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace()
    const request = await exportFor(user)

    const response = await client
      .get(`/settings/privacy/exports/${request.publicId}`)
      .loginAs(user)
      .redirects(0)

    response.assertStatus(302)
    assert.include(response.header('location'), 'signature=')

    await request.refresh()
    assert.isNotNull(request.downloadedAt)
    assert.lengthOf(await AuditLog.query().where('action', 'privacy.export.downloaded'), 1)
  })

  test("somebody else's export is a 404", async ({ client }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const { user: stranger } = await createWorkspace({ email: 'mallory@example.com' })
    const request = await exportFor(user)

    const response = await client
      .get(`/settings/privacy/exports/${request.publicId}`)
      .loginAs(stranger)
      .redirects(0)

    response.assertStatus(404)
  })

  test('an expired export cannot be downloaded', async ({ client }) => {
    const { user } = await createWorkspace()
    const request = await exportFor(user)
    request.exportExpiresAt = DateTime.utc().minus({ minutes: 1 })
    await request.save()

    const response = await client
      .get(`/settings/privacy/exports/${request.publicId}`)
      .loginAs(user)
      .redirects(0)

    response.assertHeader('location', '/settings/privacy')
    response.assertFlashMessage('error', 'That export has expired. Ask for a new one below.')
  })

  test('the purge deletes expired archives and marks them expired', async ({ assert }) => {
    const { user } = await createWorkspace()
    const expired = await exportFor(user)
    const key = expired.exportKey!
    expired.exportExpiresAt = DateTime.utc().minus({ minutes: 1 })
    await expired.save()

    const fresh = await exportFor(user)

    await queue.dispatch(purgeJob)
    await runQueue('default')

    await expired.refresh()
    await fresh.refresh()
    assert.equal(expired.status, 'expired')
    assert.isNull(expired.exportKey)
    assert.isFalse(await storage.exists({ disk: 'private', key }))
    assert.equal(fresh.status, 'completed', 'an unexpired export is left alone')
    assert.isTrue(await storage.exists({ disk: 'private', key: fresh.exportKey! }))
    assert.lengthOf(await AuditLog.query().where('action', 'privacy.export.purged'), 1)
  })

  test('running the job again changes nothing once the export is built', async ({ assert }) => {
    const { user } = await createWorkspace()
    const request = await exportFor(user)
    const completedAt = request.completedAt!.toMillis()

    await privacy.generate(request.id, false)

    await request.refresh()
    assert.equal(request.completedAt!.toMillis(), completedAt)
    assert.lengthOf(await AuditLog.query().where('action', 'privacy.export.generated'), 1)
  })

  test('an export for an account deleted in the meantime fails cleanly', async ({ assert }) => {
    const { user } = await createWorkspace()
    const { request } = await privacy.requestExport(user)
    await user.softDelete()

    await runQueue('default')

    await request.refresh()
    assert.equal(request.status, 'failed')
    assert.equal(request.failureReason, 'The account no longer exists.')
  })

  /**
   * An admin impersonating a customer can write — but a copy of the
   * customer's whole account is not something staff get this way.
   */
  test('an impersonating admin can neither request nor download', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    const { user } = await createWorkspace()
    const existing = await exportFor(user)

    const started = await client
      .post(`/admin/users/${user.publicId}/impersonate`)
      .withGuard('staff')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    assert.exists(started.session()[IMPERSONATION_SESSION_KEY])

    const ask = await client
      .post('/settings/privacy/exports')
      .withSession(started.session())
      .withCsrfToken()
      .redirects(0)
    ask.assertFlashMessage(
      'error',
      'A data export can only be requested by the person it belongs to.'
    )

    const download = await client
      .get(`/settings/privacy/exports/${existing.publicId}`)
      .withSession(started.session())
      .redirects(0)
    download.assertHeader('location', '/settings/privacy')

    assert.lengthOf(await PrivacyRequest.query().where('user_id', user.id), 1)
  })
})
