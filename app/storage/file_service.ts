import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import File from '#models/file'
import type User from '#models/user'
import Organization from '#models/organization'
import plans from '#billing/plan_service'
import storage from '#storage/disk_storage'
import { buildObjectKey, normalizeExtension } from '#storage/keys'
import { sniffFile } from '#storage/mime'
import {
  UploadRejectedError,
  type StorageDisk,
  type UploadInput,
  type ValidatedUpload,
} from '#storage/contracts'

/**
 * The largest single file, regardless of plan.
 *
 * A separate ceiling from the storage quota on purpose: the quota is what a
 * customer bought, this is what the request path can carry without a
 * timeout. A Business plan with 100 GB of quota still should not accept one
 * 20 GB upload over HTTP.
 *
 * Must stay **below** the bodyparser's multipart limit (`config/bodyparser.ts`,
 * 25mb), which is the outer envelope for the whole request. If this were the
 * larger of the two, a file inside the cap would be refused by the parser
 * before the application could say anything useful about it.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/**
 * Uploads, quota accounting, signed URLs and soft deletion (plan §10).
 *
 * The order of operations is the design. **Validate, then move, then write
 * the row and the counter in one transaction.** Moving first would leave an
 * orphan object behind every rejected upload; writing the row first would let
 * a failed move leave a file the product believes it has.
 */
export class FileService {
  /**
   * Store an uploaded file.
   *
   * Everything about the request is treated as a claim: the filename picks an
   * extension from the allowlist and is then kept only for display, the
   * reported size is re-measured, and the content type is decided by sniffing
   * the bytes (plan §10).
   */
  async upload(organization: Organization, actor: User, input: UploadInput): Promise<File> {
    const disk: StorageDisk = input.disk ?? 'private'
    const validated = await this.validate(organization, input)

    const key = buildObjectKey({
      organizationPublicId: organization.publicId,
      extension: validated.extension,
    })

    /**
     * The object goes up before the row exists. If this throws, nothing has
     * been recorded and the customer sees a failed upload — the honest
     * outcome. The reverse order would record a file that cannot be read.
     */
    await storage.moveFromTmp({
      tmpPath: input.tmpPath,
      disk,
      key,
      contentType: validated.mimeType,
    })

    try {
      return await db.transaction(async (trx) => {
        /**
         * Locked and re-checked inside the transaction, for the same reason
         * every other quota is (plan §5.5): two uploads that each fit
         * separately must not both fit together.
         */
        const locked = await Organization.query({ client: trx })
          .forUpdate()
          .where('id', organization.id)
          .firstOrFail()

        if (!input.skipQuota) {
          plans.assertStorageWithinLimit(locked, validated.sizeBytes)
        }

        const file = await File.create(
          {
            organizationId: organization.id,
            userId: actor.id,
            disk,
            key,
            originalName: this.displayName(input.clientName),
            mimeType: validated.mimeType,
            sizeBytes: validated.sizeBytes,
            visibility: disk === 'public' ? 'public' : 'private',
            checksum: validated.checksum,
            attachableType: input.attachTo?.type ?? null,
            attachableId: input.attachTo?.id ?? null,
          },
          { client: trx }
        )

        /**
         * The counter moves with the insert, never as a follow-up write a
         * crash could skip.
         */
        locked.storageUsedBytes = locked.storageUsedBytes + validated.sizeBytes
        await locked.save()

        organization.storageUsedBytes = locked.storageUsedBytes

        return file
      })
    } catch (error) {
      /**
       * The row was refused — over quota, most likely — so the object that
       * was already moved has to go, or it becomes storage nobody is
       * accounted for and nobody can reach.
       *
       * A failure to clean up is logged rather than thrown: the customer's
       * error is the quota, and replacing it with "could not delete a
       * temporary object" tells them nothing they can act on. The purge job's
       * reconciliation is what catches whatever this misses.
       */
      await storage.delete({ disk, key }).catch((cleanupError) => {
        logger.error(
          { err: cleanupError, disk, key, organizationId: organization.id },
          'could not remove an object after its database row was refused'
        )
      })

      throw error
    }
  }

  /**
   * Everything the Files screen lists.
   */
  async forOrganization(
    organization: Organization,
    options: { limit?: number } = {}
  ): Promise<File[]> {
    return File.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .preload('user')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(options.limit ?? 100)
  }

  /**
   * One file, scoped to the organisation.
   *
   * Tenancy is part of the lookup rather than a check after it, so another
   * workspace's id behaves exactly like one that does not exist.
   */
  async find(organization: Organization, publicId: string): Promise<File | null> {
    return File.query()
      .where('public_id', publicId)
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .first()
  }

  /**
   * A URL for a file. Private files are signed with a short TTL; public ones
   * get their CDN URL (`DiskStorage` decides, not the caller).
   */
  async urlFor(file: File, options: { download?: boolean } = {}): Promise<string> {
    return storage.urlFor({
      disk: file.disk,
      key: file.key,
      downloadAs: options.download ? file.originalName : undefined,
    })
  }

  /**
   * Soft-delete a file and give its bytes back.
   *
   * The object stays in the bucket; `PurgeDeletedFilesJob` removes it after
   * 30 days, so deleting the wrong thing is recoverable for a month. The
   * quota is released immediately, because a customer who deleted something
   * to make room should be able to use that room now.
   */
  async delete(file: File): Promise<void> {
    await db.transaction(async (trx) => {
      const locked = await Organization.query({ client: trx })
        .forUpdate()
        .where('id', file.organizationId)
        .firstOrFail()

      file.useTransaction(trx)
      file.deletedAt = DateTime.utc()
      await file.save()

      locked.storageUsedBytes = Math.max(locked.storageUsedBytes - file.sizeBytes, 0)
      await locked.save()
    })
  }

  /**
   * Replace a user's avatar or an organisation's logo.
   *
   * The old file is soft-deleted rather than overwritten in place, so a
   * cached CDN URL never starts serving somebody's new picture under the old
   * key — and so an accidental replacement is as recoverable as an accidental
   * delete.
   */
  async replaceAttachment(
    organization: Organization,
    actor: User,
    input: UploadInput & { attachTo: { type: 'User' | 'Organization'; id: number } }
  ): Promise<File> {
    const previous = await File.query()
      .where('organization_id', organization.id)
      .where('attachable_type', input.attachTo.type)
      .where('attachable_id', input.attachTo.id)
      .whereNull('deleted_at')

    const file = await this.upload(organization, actor, { ...input, disk: 'public' })

    for (const old of previous) {
      await this.delete(old)
    }

    return file
  }

  /**
   * Recompute `storage_used_bytes` from the rows.
   *
   * Used by the purge job to report drift. It is a report, not a repair, for
   * the same reason `ReconcileCountersJob` is: the counter only moves inside
   * the transaction that moves a row, so drift means a bug, and quietly
   * fixing it nightly hides that bug for ever.
   */
  async countedBytes(organization: Organization, trx?: TransactionClientContract): Promise<number> {
    const [row] = await File.query(trx ? { client: trx } : {})
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .sum('size_bytes as total')

    return Number(row.$extras.total ?? 0)
  }

  /**
   * Everything an upload has to prove before a single byte is moved
   * (plan §10).
   */
  private async validate(organization: Organization, input: UploadInput): Promise<ValidatedUpload> {
    const extension = normalizeExtension(input.clientName)

    if (!extension) {
      throw new UploadRejectedError(
        'That kind of file is not accepted. Images, PDFs, text and CSV are.',
        'extension_not_allowed'
      )
    }

    /**
     * Measured, not believed. The reported size is a request field, and the
     * quota is what a customer is paying for.
     */
    const { size, checksum } = await this.measure(input.tmpPath)

    if (size === 0) {
      throw new UploadRejectedError('That file is empty.', 'empty')
    }

    if (size > MAX_FILE_BYTES) {
      throw new UploadRejectedError(
        `Files are limited to ${File.formatBytes(MAX_FILE_BYTES)} each.`,
        'too_large'
      )
    }

    /**
     * Checked before the move as well as inside the transaction. Here it
     * saves uploading bytes that are about to be refused; there it is the one
     * that is actually safe against a concurrent upload.
     */
    if (!input.skipQuota) {
      plans.assertStorageWithinLimit(organization, size)
    }

    const sniffed = await sniffFile(input.tmpPath, extension)

    if (!sniffed) {
      throw new UploadRejectedError(
        'We could not recognise the contents of that file.',
        'unrecognised_content'
      )
    }

    if (!sniffed.matchesExtension) {
      /**
       * Refused rather than corrected. Renaming a file to match its bytes is
       * how something executable ends up stored as an image — and a customer
       * whose `.png` is really a PDF wants to know, not to have it silently
       * renamed.
       */
      throw new UploadRejectedError(
        `That file is named .${extension} but its contents are ${sniffed.mimeType}.`,
        'content_does_not_match_extension'
      )
    }

    return { extension, mimeType: sniffed.mimeType, sizeBytes: size, checksum }
  }

  /**
   * Size and SHA-256 in one pass over the file.
   */
  private async measure(path: string): Promise<{ size: number; checksum: string }> {
    const hash = createHash('sha256')
    let size = 0

    for await (const chunk of createReadStream(path)) {
      size += chunk.length
      hash.update(chunk)
    }

    return { size, checksum: hash.digest('hex') }
  }

  /**
   * The client's filename, kept for display only.
   *
   * Stripped of any path and clamped, because it is rendered in a list and
   * put into a `Content-Disposition` header. The key it is stored under is a
   * uuid and owes nothing to this.
   */
  private displayName(clientName: string): string {
    const base = clientName.split(/[\\/]/).pop() ?? 'file'
    return base.replace(/[\r\n"]/g, '').slice(0, 200) || 'file'
  }
}

export default new FileService()
