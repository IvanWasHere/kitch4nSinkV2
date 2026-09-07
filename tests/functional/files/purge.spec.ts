import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'

import File from '#models/file'
import files from '#storage/file_service'
import storage from '#storage/disk_storage'
import purgeDeletedFilesJob, { RETENTION_DAYS } from '#queue/jobs/purge_deleted_files_job'
import { clearStorage, createWorkspace, fixtureUpload, runQueue } from '#tests/helpers'

/**
 * The purge job (plan §10).
 *
 * A soft delete is a promise that the file is recoverable for 30 days. This
 * suite is what keeps that promise honest in both directions: nothing goes
 * early, and nothing stays for ever.
 */
test.group('Purging deleted files', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => clearStorage)

  const deletedDaysAgo = async (days: number) => {
    const { user, organization } = await createWorkspace()
    const file = await files.upload(organization, user, await fixtureUpload('pdf'))

    await files.delete(file)

    file.deletedAt = DateTime.utc().minus({ days })
    await file.save()

    return { file, organization }
  }

  test('leaves a file that is still inside the retention window', async ({ assert }) => {
    const { file } = await deletedDaysAgo(RETENTION_DAYS - 1)

    await purgeDeletedFilesJob.handle()

    assert.isNotNull(await File.find(file.id), 'the row is still there to restore from')
    assert.isTrue(await storage.exists({ disk: file.disk, key: file.key }))
  })

  test('removes the object and the row once the window has passed', async ({ assert }) => {
    const { file } = await deletedDaysAgo(RETENTION_DAYS + 1)

    await purgeDeletedFilesJob.handle()

    assert.isNull(await File.find(file.id))
    assert.isFalse(await storage.exists({ disk: file.disk, key: file.key }))
  })

  test('never touches a file that was not deleted', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const file = await files.upload(organization, user, await fixtureUpload('png'))

    await purgeDeletedFilesJob.handle()

    assert.isNotNull(await File.find(file.id))
    assert.isTrue(await storage.exists({ disk: file.disk, key: file.key }))
  })

  /**
   * At-least-once delivery means every handler runs twice sooner or later
   * (plan §9). An object that has already gone is the expected case on the
   * second run, not an error.
   */
  test('is idempotent — running it twice is the same as once', async ({ assert }) => {
    const { file } = await deletedDaysAgo(RETENTION_DAYS + 1)

    await purgeDeletedFilesJob.handle()
    await purgeDeletedFilesJob.handle()

    assert.isNull(await File.find(file.id))
  })

  /**
   * The object goes first. A crash in between leaves a row pointing at
   * nothing — recoverable, and the next run finishes it — rather than an
   * object nothing points at, which is a bill nobody can explain.
   */
  test('survives an object that has already gone from the bucket', async ({ assert }) => {
    const { file } = await deletedDaysAgo(RETENTION_DAYS + 1)

    await storage.delete({ disk: file.disk, key: file.key })

    await purgeDeletedFilesJob.handle()

    assert.isNull(await File.find(file.id), 'the row is tidied up anyway')
  })

  test('the purged bytes were already given back at delete time', async ({ assert }) => {
    const { organization } = await deletedDaysAgo(RETENTION_DAYS + 1)

    await organization.refresh()
    assert.equal(organization.storageUsedBytes, 0)

    await purgeDeletedFilesJob.handle()
    await organization.refresh()

    assert.equal(organization.storageUsedBytes, 0, 'and purging does not double-count')
  })

  test('runs through the queue like every other job', async ({ assert }) => {
    const { file } = await deletedDaysAgo(RETENTION_DAYS + 1)

    const { default: queue } = await import('#queue/queue_service')
    await queue.dispatch(purgeDeletedFilesJob)

    const processed = await runQueue('default')

    assert.equal(processed, 1)
    assert.isNull(await File.find(file.id))
  })
})
