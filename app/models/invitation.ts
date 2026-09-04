import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import Organization from '#models/organization'
import { InvitationSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'

/**
 * An outstanding invitation to join an organisation.
 *
 * "Pending" is a computed state rather than a column: an invitation is
 * pending when it has not been accepted, has not been revoked, and has not
 * expired. Storing a status column as well would give two sources of truth
 * that drift the moment an expiry passes without a job running.
 *
 * The checks below test truthiness rather than `!== null`. A column that was
 * never assigned on a freshly created model is `undefined`, not `null`, so
 * `acceptedAt !== null` reports a brand-new invitation as already accepted —
 * a trap every nullable-timestamp getter in this codebase shares.
 */
export default class Invitation extends compose(InvitationSchema, withPublicId('invitation')) {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'invitedByUserId' })
  declare invitedBy: BelongsTo<typeof User>

  get isExpired() {
    return this.expiresAt <= DateTime.utc()
  }

  get isAccepted() {
    return Boolean(this.acceptedAt)
  }

  get isRevoked() {
    return Boolean(this.revokedAt)
  }

  get isPending() {
    return !this.isAccepted && !this.isRevoked && !this.isExpired
  }

  /**
   * What the members screen shows in the status column.
   */
  get status(): 'pending' | 'accepted' | 'revoked' | 'expired' {
    if (this.isAccepted) return 'accepted'
    if (this.isRevoked) return 'revoked'
    if (this.isExpired) return 'expired'
    return 'pending'
  }
}
