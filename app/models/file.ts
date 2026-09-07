import { compose } from '@adonisjs/core/helpers'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import Organization from '#models/organization'
import { FileSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'
import { withSoftDelete } from '#models/mixins/with_soft_delete'

/**
 * A stored object (plan §10).
 *
 * It knows its `disk` and its `key` and deliberately cannot produce a URL on
 * its own — reading a file means going through `FileService`, which is where
 * the signing policy lives. A `get url()` here would be a URL cached in a
 * template with a TTL nobody chose.
 */
export default class File extends compose(FileSchema, withPublicId('file'), withSoftDelete) {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  /**
   * The uploader, as provenance. Never an access check: files belong to the
   * organisation, the same rule lists follow (D8).
   */
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  get isImage() {
    return this.mimeType.startsWith('image/')
  }

  get isPublic() {
    return this.visibility === 'public'
  }

  /**
   * The extension as stored, taken from the key rather than from
   * `original_name` — the key is what we control, and the client's filename
   * is not to be trusted for anything but display (plan §10).
   */
  get extension(): string {
    const match = this.key.match(/\.([a-z0-9]+)$/i)
    return match ? match[1].toLowerCase() : ''
  }

  get formattedSize() {
    return File.formatBytes(this.sizeBytes)
  }

  static formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`
    }

    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`
    }

    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
}
