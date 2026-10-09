import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'
import { beforeSave } from '@adonisjs/lucid/orm'

import { WaitingListEntrySchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'

/**
 * Somebody who asked to be told when registration opens (plan §22.5).
 *
 * Four states, and the PRD's `invited` is deliberately absent: there is no
 * invite flow to put anyone in it (plan §19 Q7e).
 *
 *   pending_confirmation → confirmed → converted
 *   any                  → cancelled   (staff)
 */
export default class WaitingListEntry extends compose(
  WaitingListEntrySchema,
  withPublicId('waitingListEntry')
) {
  /**
   * The same rule `User` follows, so the unique index is case-insensitive
   * and an address typed in capitals cannot join twice.
   */
  @beforeSave()
  static normaliseEmail(entry: WaitingListEntry) {
    if (entry.$dirty.email && entry.email) {
      entry.email = entry.email.trim().toLowerCase()
    }
  }

  get isPending() {
    return this.status === 'pending_confirmation'
  }

  get isConfirmationExpired() {
    return !this.confirmationExpiresAt || this.confirmationExpiresAt <= DateTime.utc()
  }
}
