import type { AllowedExtension } from '#storage/keys'

/**
 * The storage abstraction (plan §4, §10).
 *
 * Drive is already the provider abstraction, so this interface is
 * deliberately *thinner* than Drive rather than a mirror of it: five
 * operations, expressed in the terms this application actually uses. Its job
 * is not to hide Drive — it is to make sure the signing TTL, the key
 * convention and the visibility rules exist in exactly one place instead of
 * at every call site.
 *
 * Nothing outside `app/storage/` calls Drive directly.
 */
export interface FileStorage {
  /**
   * Move a file the bodyparser has already written to a temporary path.
   *
   * A move rather than a read-then-write: the file is already on disk, and
   * streaming it through the application to put it back would double the
   * memory cost of every upload for nothing.
   */
  moveFromTmp(input: {
    tmpPath: string
    disk: StorageDisk
    key: string
    contentType: string
  }): Promise<void>

  delete(input: { disk: StorageDisk; key: string }): Promise<void>

  exists(input: { disk: StorageDisk; key: string }): Promise<boolean>

  /**
   * A URL a browser can use.
   *
   * Private objects get a signed URL with a short TTL; public ones get their
   * CDN URL. Which of the two happens is decided by the disk, not by the
   * caller, so a private file cannot be handed out unsigned by mistake.
   */
  urlFor(input: {
    disk: StorageDisk
    key: string
    expiresIn?: string
    downloadAs?: string
  }): Promise<string>

  /**
   * Every key under a prefix. Used by the purge job to find objects the
   * database no longer knows about.
   */
  list(input: { disk: StorageDisk; prefix: string }): Promise<string[]>
}

/**
 * A *purpose*, not a vendor (see `config/drive.ts`).
 */
export type StorageDisk = 'private' | 'public'

export interface UploadInput {
  /**
   * The temporary path the bodyparser wrote to, the client's filename, and
   * the size it reported. All three come from the request and none is trusted
   * beyond what `FileService` verifies.
   */
  tmpPath: string
  clientName: string
  sizeBytes: number

  disk?: StorageDisk

  /**
   * Optional polymorphic owner — an avatar on a user, a logo on an
   * organisation, an image on a support message (plan §21.3).
   */
  attachTo?: { type: 'User' | 'Organization' | 'SupportMessage'; id: number }

  /**
   * Record the bytes against the workspace but do not refuse the upload for
   * being over the storage cap.
   *
   * Exactly one caller sets this: a support attachment (plan §21.3).
   * Otherwise a customer at their limit cannot attach a screenshot to the
   * ticket they are opening *about being at their limit*. The meter still
   * counts it, so the number stays honest — only the refusal is skipped.
   */
  skipQuota?: boolean
}

export interface ValidatedUpload {
  extension: AllowedExtension
  mimeType: string
  sizeBytes: number
  checksum: string
}

/**
 * An upload refused before anything was moved.
 *
 * `reason` is machine-readable because the API needs to say *why* — "too
 * large" and "not that kind of file" call for different things from the
 * caller, and a single opaque 422 makes an integration guess.
 */
export class UploadRejectedError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'extension_not_allowed'
      | 'content_does_not_match_extension'
      | 'unrecognised_content'
      | 'too_large'
      | 'empty'
  ) {
    super(message)
  }
}
