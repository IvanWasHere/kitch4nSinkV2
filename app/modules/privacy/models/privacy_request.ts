import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import { PrivacyRequestSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'

/**
 * A request to export or delete a person's data (plan §22.8).
 *
 *   export:    requested → processing → completed → expired   (or failed)
 *   deletion:  requested → confirmed → approved → processing → completed
 *                                    ↘ rejected                ↘ failed
 */
export default class PrivacyRequest extends compose(
  PrivacyRequestSchema,
  withPublicId('privacyRequest')
) {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  get isExport() {
    return this.type === 'export'
  }

  /**
   * Started by staff on the person's behalf rather than by the person.
   */
  get isStaffInitiated() {
    return Boolean(this.requestedByStaffId)
  }

  /**
   * Still being worked on — the states that count towards "one active
   * request of each kind per person".
   */
  get isActive() {
    return ['requested', 'confirmed', 'approved', 'processing'].includes(this.status)
  }

  /**
   * An export that can be downloaded right now.
   */
  get isDownloadable() {
    return (
      this.isExport &&
      this.status === 'completed' &&
      Boolean(this.exportKey) &&
      Boolean(this.exportExpiresAt) &&
      this.exportExpiresAt! > DateTime.utc()
    )
  }
}
