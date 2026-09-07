import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

import File from '#models/file'
import Organization from '#models/organization'
import files from '#storage/file_service'
import storage from '#storage/disk_storage'
import { organizationPrefix } from '#storage/keys'
import type { JobHandler } from '#queue/contracts'

/**
 * How long a soft-deleted file is recoverable (plan §10).
 *
 * Long enough that somebody who deleted the wrong thing and noticed a week
 * later can still be helped, short enough that a customer is not paying for
 * storage of things they deleted last quarter.
 */
export const RETENTION_DAYS = 30

/**
 * Removes the objects behind expired soft deletes, and reports drift
 * (plan §10).
 *
 * Two jobs in one, because they need the same listing:
 *
 * 1. **Purge.** Delete the object, then the row — in that order, so a crash
 *    in between leaves a row pointing at nothing (recoverable, and the next
 *    run finishes it) rather than an object nothing points at (a bill nobody
 *    can explain).
 * 2. **Reconcile.** Compare what the bucket holds against what the database
 *    says, and compare `storage_used_bytes` against the sum of the rows. Both
 *    are **reported, not repaired** — the counter only ever moves inside the
 *    transaction that moves a row, so drift means a bug, and a job that
 *    quietly fixes it every night hides that bug for ever.
 *
 * Idempotent: deleting an object that has already gone is not an error, and a
 * row whose object is missing is exactly what the second run expects to find.
 */
class PurgeDeletedFilesJob implements JobHandler {
  readonly name = 'purge_deleted_files'

  async handle() {
    const purged = await this.purge()
    await this.reconcile()

    logger.info({ purged }, 'purged deleted files')
  }

  private async purge(): Promise<number> {
    const cutoff = DateTime.utc().minus({ days: RETENTION_DAYS })

    /**
     * Expiry is decided from the model's own timestamp rather than in SQL: a
     * `where deleted_at < ?` compares as text on SQLite and as a timestamp on
     * Postgres, so it would quietly mean two different things (CONTRIBUTING).
     */
    const candidates = await File.query().whereNotNull('deleted_at').orderBy('id', 'asc')
    const expired = candidates.filter((file) => file.deletedAt && file.deletedAt <= cutoff)

    let purged = 0

    for (const file of expired) {
      try {
        await storage.delete({ disk: file.disk, key: file.key })
      } catch (error) {
        /**
         * An object that has already gone is the expected case on a retry.
         * Anything else is worth a line, and the row is left for the next run
         * rather than deleted — a row is the only record that the object
         * existed.
         */
        logger.warn(
          { err: error, fileId: file.id, disk: file.disk, key: file.key },
          'could not delete a purged object'
        )
        continue
      }

      /**
       * A hard delete: this is the one place in the codebase that removes a
       * `files` row, and it does so only after the object is gone.
       */
      await File.query().where('id', file.id).delete()
      purged++
    }

    return purged
  }

  /**
   * Report what the bucket and the database disagree about.
   */
  private async reconcile(): Promise<void> {
    const organizations = await Organization.query().whereNull('deleted_at')

    for (const organization of organizations) {
      const counted = await files.countedBytes(organization)

      if (counted !== organization.storageUsedBytes) {
        logger.error(
          {
            organizationId: organization.id,
            publicId: organization.publicId,
            stored: organization.storageUsedBytes,
            counted,
          },
          'storage_used_bytes drifted — the counter only moves inside the file transaction, so this is a bug'
        )
      }

      await this.reportOrphans(organization)
    }
  }

  /**
   * Objects under a tenant's prefix that no live row claims.
   *
   * This is what the tenant-first key convention buys: "everything this
   * customer has in the bucket" is one prefix listing (plan §10).
   *
   * Orphans are reported and left alone. Deleting an object the database has
   * no row for would, on the one day the row was missing for a different
   * reason, delete a customer's file — and the whole point of a soft delete
   * is that this job never destroys anything nobody asked it to.
   */
  private async reportOrphans(organization: Organization): Promise<void> {
    const prefix = organizationPrefix(organization.publicId)

    for (const disk of ['private', 'public'] as const) {
      let keys: string[]

      try {
        keys = await storage.list({ disk, prefix })
      } catch (error) {
        logger.warn({ err: error, disk, prefix }, 'could not list a tenant prefix')
        continue
      }

      if (keys.length === 0) {
        continue
      }

      /**
       * Every row, including soft-deleted ones: an object whose row is
       * pending purge is accounted for, not an orphan.
       */
      const rows = await File.query()
        .where('organization_id', organization.id)
        .where('disk', disk)
        .select('key')

      const known = new Set(rows.map((row) => row.key))
      const orphans = keys.filter((key) => !known.has(key))

      if (orphans.length > 0) {
        logger.error(
          {
            organizationId: organization.id,
            disk,
            count: orphans.length,
            sample: orphans.slice(0, 5),
          },
          'objects in the bucket that no file row claims'
        )
      }
    }
  }
}

export default new PurgeDeletedFilesJob()
