import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import File from '#models/file'
import files, { MAX_FILE_BYTES } from '#storage/file_service'
import storage from '#storage/disk_storage'
import plans, { BYTES_PER_MB } from '#billing/plan_service'
import { UploadRejectedError } from '#storage/contracts'
import PlanLimitExceededException from '#exceptions/plan_limit_exceeded_exception'
import {
  addMember,
  clearStorage,
  createWorkspace,
  FILE_FIXTURES,
  fixtureUpload,
} from '#tests/helpers'

test.group('Uploads', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => clearStorage)

  test('stores the object and records disk and key, never a URL', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const file = await files.upload(organization, user, await fixtureUpload('png'))

    assert.equal(file.disk, 'private')
    assert.match(file.key, /^orgs\/org_[a-z0-9]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/)
    assert.notInclude(file.key, 'http')
    assert.equal(file.mimeType, 'image/png')
    assert.equal(file.organizationId, organization.id)
    assert.equal(file.userId, user.id)
    assert.match(file.publicId, /^fil_/)

    assert.isTrue(
      await storage.exists({ disk: file.disk, key: file.key }),
      'and the bytes are really there'
    )
  })

  /**
   * The client filename is display-only. The key it is stored under owes
   * nothing to it (plan §10).
   */
  test('keeps the original name for display and nothing else', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const file = await files.upload(
      organization,
      user,
      await fixtureUpload('png', { clientName: 'Q3 report.png' })
    )

    assert.equal(file.originalName, 'Q3 report.png')
    assert.notInclude(file.key, 'Q3')
  })

  test('strips any path from the name it displays', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const file = await files.upload(
      organization,
      user,
      await fixtureUpload('png', { clientName: '../../../etc/passwd.png' })
    )

    assert.equal(file.originalName, 'passwd.png')
    assert.notInclude(file.key, '..')
  })

  test('measures the size itself rather than believing the request', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const upload = await fixtureUpload('pdf')

    const file = await files.upload(organization, user, { ...upload, sizeBytes: 1 })

    assert.equal(file.sizeBytes, upload.sizeBytes, 'the reported size was a claim')
    assert.isAbove(file.sizeBytes, 1)
  })

  test('records a checksum of the bytes', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const file = await files.upload(organization, user, await fixtureUpload('pdf'))

    assert.match(file.checksum!, /^[0-9a-f]{64}$/)
  })

  test('moves the storage counter in the same transaction as the row', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const upload = await fixtureUpload('pdf')

    await files.upload(organization, user, upload)
    await organization.refresh()

    assert.equal(organization.storageUsedBytes, upload.sizeBytes)
    assert.equal(await files.countedBytes(organization), upload.sizeBytes)
  })

  test('any member can upload', async ({ assert, client }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const upload = await fixtureUpload('csv')
    const file = await files.upload(organization, member, upload)

    assert.equal(file.userId, member.id)

    const response = await client.get('/files').loginAs(member)
    response.assertStatus(200)
    response.assertTextIncludes('fixture.csv')
  })
})

/**
 * Everything an upload has to prove before a byte is moved (plan §10).
 */
test.group('Upload validation', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => clearStorage)

  const reject = async (upload: Awaited<ReturnType<typeof fixtureUpload>>, reason: string) => {
    const { user, organization } = await createWorkspace()

    try {
      await files.upload(organization, user, upload)
      return { threw: false, reason: null, organization }
    } catch (error) {
      if (!(error instanceof UploadRejectedError)) {
        throw error
      }
      return { threw: true, reason: error.reason, organization, expected: reason }
    }
  }

  test('refuses an extension that is not on the allowlist', async ({ assert }) => {
    const result = await reject(
      await fixtureUpload('png', { clientName: 'payload.exe' }),
      'extension_not_allowed'
    )

    assert.isTrue(result.threw)
    assert.equal(result.reason, 'extension_not_allowed')
  })

  /**
   * The attack the sniffing exists for: an HTML document wearing an image
   * extension, which a browser would happily render as a page from our own
   * origin.
   */
  test('refuses an HTML document named .png', async ({ assert }) => {
    const result = await reject(
      await fixtureUpload('png', {
        clientName: 'avatar.png',
        bytes: Buffer.from(FILE_FIXTURES.html),
      }),
      'unrecognised_content'
    )

    assert.isTrue(result.threw)
    assert.equal(result.reason, 'unrecognised_content')
  })

  test('refuses a file whose contents disagree with its name', async ({ assert }) => {
    const result = await reject(
      await fixtureUpload('pdf', { clientName: 'holiday.png' }),
      'content_does_not_match_extension'
    )

    assert.isTrue(result.threw)
    assert.equal(result.reason, 'content_does_not_match_extension')
  })

  test('refuses an empty file', async ({ assert }) => {
    const result = await reject(await fixtureUpload('txt', { bytes: Buffer.alloc(0) }), 'empty')

    assert.isTrue(result.threw)
    assert.equal(result.reason, 'empty')
  })

  test('refuses a file over the per-file ceiling', async ({ assert }) => {
    const oversized = Buffer.concat([
      Buffer.from(FILE_FIXTURES.pdf),
      Buffer.alloc(MAX_FILE_BYTES + 1),
    ])

    const result = await reject(await fixtureUpload('pdf', { bytes: oversized }), 'too_large')

    assert.isTrue(result.threw)
    assert.equal(result.reason, 'too_large')
  })

  /**
   * A refused upload must leave nothing behind — neither a row nor an object
   * nobody is accounted for.
   */
  test('a refusal writes no row and moves no counter', async ({ assert }) => {
    const { organization } = await reject(
      await fixtureUpload('png', { clientName: 'payload.exe' }),
      'extension_not_allowed'
    )

    await organization.refresh()

    assert.lengthOf(await File.all(), 0)
    assert.equal(organization.storageUsedBytes, 0)
  })
})

/**
 * The storage quota (plan §7.4, §10). Free allows 100 MB.
 */
test.group('Storage quota', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => clearStorage)

  /**
   * Capped with the same staff override mechanism the other limits use, so
   * the ceiling under test is the real one without uploading 100 MB.
   */
  const cappedWorkspace = async (limitMb: number) => {
    const { user, organization } = await createWorkspace()

    organization.limitOverrides = { storageMb: limitMb }
    await organization.save()

    return { user, organization }
  }

  const filler = (bytes: number) =>
    Buffer.concat([Buffer.from(FILE_FIXTURES.pdf), Buffer.alloc(Math.max(bytes - 73, 0))])

  test('refuses an upload that would cross the cap, with the numbers', async ({ assert }) => {
    const { user, organization } = await cappedWorkspace(1)

    await files.upload(
      organization,
      user,
      await fixtureUpload('pdf', { bytes: filler(700 * 1024) })
    )

    try {
      await files.upload(
        organization,
        user,
        await fixtureUpload('pdf', { bytes: filler(700 * 1024) })
      )
      assert.fail('the second upload should have been refused')
    } catch (error) {
      assert.instanceOf(error, PlanLimitExceededException)

      const details = (error as PlanLimitExceededException).details
      assert.equal(details.limit, 'storageMb')
      assert.equal(details.allowed, 1)
    }

    assert.lengthOf(await File.all(), 1)
  })

  /**
   * The object is moved before the row is written, so a refusal inside the
   * transaction has to take the object with it — otherwise every over-quota
   * attempt leaves storage nobody is billed for and nobody can reach.
   */
  test('a refusal inside the transaction leaves no orphan object', async ({ assert }) => {
    const { user, organization } = await cappedWorkspace(1)

    /**
     * Passes the pre-flight check against a stale counter, then loses to the
     * locked re-check: the counter is bumped underneath it, exactly as a
     * concurrent upload would.
     */
    const upload = await fixtureUpload('pdf', { bytes: filler(600 * 1024) })
    organization.storageUsedBytes = 0
    await organization.save()

    const raced = await files.upload(
      organization,
      user,
      await fixtureUpload('pdf', { bytes: filler(600 * 1024) })
    )

    await assert.rejects(() => files.upload(organization, user, upload), PlanLimitExceededException)

    const keys = await storage.list({
      disk: 'private',
      prefix: `orgs/${organization.publicId}/`,
    })

    assert.deepEqual(keys, [raced.key], 'only the upload that was recorded is in the bucket')
  })

  test('two concurrent uploads cannot both take the last of the quota', async ({ assert }) => {
    const { user, organization } = await cappedWorkspace(1)

    const results = await Promise.allSettled([
      files.upload(organization, user, await fixtureUpload('pdf', { bytes: filler(600 * 1024) })),
      files.upload(organization, user, await fixtureUpload('pdf', { bytes: filler(600 * 1024) })),
    ])

    assert.lengthOf(
      results.filter((result) => result.status === 'fulfilled'),
      1,
      'exactly one upload fitted'
    )

    await organization.refresh()
    assert.isAtMost(organization.storageUsedBytes, BYTES_PER_MB)
  })

  test('deleting a file frees its space immediately', async ({ assert }) => {
    const { user, organization } = await cappedWorkspace(1)

    const file = await files.upload(
      organization,
      user,
      await fixtureUpload('pdf', { bytes: filler(700 * 1024) })
    )

    await files.delete(file)
    await organization.refresh()

    assert.equal(organization.storageUsedBytes, 0)

    const replacement = await files.upload(
      organization,
      user,
      await fixtureUpload('pdf', { bytes: filler(700 * 1024) })
    )

    assert.isNotNull(replacement.id, 'so the space really was released')
  })

  /**
   * A soft delete keeps the object, so an accidental delete is recoverable
   * for 30 days (plan §10).
   */
  test('deleting is soft — the object stays until the purge job runs', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const file = await files.upload(organization, user, await fixtureUpload('png'))

    await files.delete(file)

    assert.isTrue(await storage.exists({ disk: file.disk, key: file.key }))
    assert.isNull(await files.find(organization, file.publicId), 'but it is gone from the screen')
  })

  test('an unlimited plan has no storage ceiling', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    organization.limitOverrides = { storageMb: null }
    await organization.save()

    await files.upload(
      organization,
      user,
      await fixtureUpload('pdf', { bytes: filler(2 * BYTES_PER_MB) })
    )

    const usage = plans.storageUsage(organization)
    assert.isNull(usage.limit)
    assert.isFalse(usage.isFull)
  })

  /**
   * The meter and the enforcement read the same number (plan §7.4).
   */
  test('the meter rounds up, so one byte is not reported as nothing', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    await files.upload(organization, user, await fixtureUpload('txt'))
    await organization.refresh()

    const usage = plans.storageUsage(organization)
    assert.equal(usage.current, 1)
    assert.equal(usage.limit, 100)
  })
})

test.group('Downloads', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => clearStorage)

  /**
   * A private file is served through a signed URL with a short TTL, never
   * proxied through the application (plan §10).
   */
  test('redirects to a signed URL rather than streaming the bytes', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const file = await files.upload(organization, user, await fixtureUpload('pdf'))

    const response = await client.get(`/files/${file.publicId}`).loginAs(user).redirects(0)

    response.assertStatus(302)

    const location = response.header('location') as string
    assert.include(location, file.key)
    assert.include(location, 'signature=', 'a private object is never handed out unsigned')
  })

  /**
   * `config/app.ts` forwards the request's query string onto every redirect,
   * which is right for a redirect back to one of our own screens and wrong
   * for one to a URL somebody else built: appended after a signed URL's own
   * query string, it is no longer the string that was signed, and the
   * download 401s. This is the regression test for that.
   */
  test('the signed URL is not corrupted by the redirect forwarding our query string', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    const file = await files.upload(organization, user, await fixtureUpload('pdf'))

    const response = await client
      .get(`/files/${file.publicId}?download=1`)
      .loginAs(user)
      .redirects(0)

    const location = response.header('location') as string

    assert.notInclude(
      location.split('signature=')[1] ?? '',
      '?',
      'nothing is appended after the signature'
    )

    /**
     * And the URL actually works — the strongest form of the assertion, since
     * it is the signature check itself that decides.
     */
    const path = location.replace(/^https?:\/\/[^/]+/, '')
    const download = await client.get(path)

    download.assertStatus(200)
  })

  test('a download carries the name the customer uploaded', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const file = await files.upload(
      organization,
      user,
      await fixtureUpload('pdf', { clientName: 'Invoice 2026.pdf' })
    )

    const response = await client
      .get(`/files/${file.publicId}?download=1`)
      .loginAs(user)
      .redirects(0)

    const location = response.header('location') as string
    assert.include(decodeURIComponent(location), 'Invoice 2026.pdf')
  })

  test('a file that does not exist is a message, not a 500', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/files/fil_zzzzzzzzzzzz').loginAs(user).redirects(0)

    response.assertStatus(302)
    response.assertFlashMessage('error', 'That file no longer exists.')
  })
})

/**
 * Avatars and logos (plan §17, M5).
 */
test.group('Attachments', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => clearStorage)

  test('an avatar goes on the public disk and is stored as a key', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    const response = await client
      .post('/settings/profile/avatar')
      .loginAs(user)
      .file('avatar', Buffer.from(FILE_FIXTURES.png), { filename: 'me.png' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await user.refresh()
    assert.isNotNull(user.avatarKey)
    assert.notInclude(user.avatarKey!, 'http', 'a key, never a URL')

    const file = await File.findByOrFail('key', user.avatarKey!)
    assert.equal(file.disk, 'public')
    assert.equal(file.visibility, 'public')
    assert.equal(file.attachableType, 'User')
    assert.equal(file.attachableId, user.id)
    assert.equal(file.organizationId, organization.id)
  })

  /**
   * Replacing soft-deletes the old one rather than overwriting the key, so a
   * cached CDN URL never starts serving somebody's new picture.
   */
  test('replacing an avatar retires the old file instead of overwriting it', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace()

    const upload = () =>
      client
        .post('/settings/profile/avatar')
        .loginAs(user)
        .file('avatar', Buffer.from(FILE_FIXTURES.png), { filename: 'me.png' })
        .withCsrfToken()
        .redirects(0)

    await upload()
    await user.refresh()
    const first = user.avatarKey

    await upload()
    await user.refresh()

    assert.notEqual(user.avatarKey, first, 'a new key')

    const retired = await File.findByOrFail('key', first!)
    assert.isNotNull(retired.deletedAt, 'and the old row is soft-deleted')
  })

  test('a logo is owner-only', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client
      .post('/settings/organization/logo')
      .loginAs(member)
      .file('logo', Buffer.from(FILE_FIXTURES.png), { filename: 'logo.png' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await organization.refresh()
    assert.isNull(organization.logoKey)
  })

  test('the owner can set a logo', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    await client
      .post('/settings/organization/logo')
      .loginAs(user)
      .file('logo', Buffer.from(FILE_FIXTURES.png), { filename: 'logo.png' })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.isNotNull(organization.logoKey)
  })

  test('a non-image is refused as an avatar', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    const response = await client
      .post('/settings/profile/avatar')
      .loginAs(user)
      .file('avatar', Buffer.from(FILE_FIXTURES.pdf), { filename: 'me.png' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await user.refresh()
    assert.isNull(user.avatarKey)
  })
})
