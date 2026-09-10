import { compose } from '@adonisjs/core/helpers'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import StaffUser from '#models/staff_user'
import Organization from '#models/organization'
import SupportMessage from '#models/support_message'
import { SupportTicketSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'
import { withSoftDelete } from '#models/mixins/with_soft_delete'

/**
 * A support conversation (plan §21).
 *
 * The ticket owns the state; a message never carries one. `open` is waiting
 * on us, `answered` is waiting on the customer, `resolved` is done until
 * somebody replies to it.
 */
export default class SupportTicket extends compose(
  SupportTicketSchema,
  withPublicId('supportTicket'),
  withSoftDelete
) {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'createdByUserId' })
  declare createdBy: BelongsTo<typeof User>

  @belongsTo(() => StaffUser, { foreignKey: 'assignedStaffId' })
  declare assignedStaff: BelongsTo<typeof StaffUser>

  @hasMany(() => SupportMessage, { foreignKey: 'supportTicketId' })
  declare messages: HasMany<typeof SupportMessage>

  get isResolved() {
    return this.status === 'resolved'
  }

  /**
   * Staff replied last and the customer has not answered. This is the whole
   * of "unread" for the tenant side — no `seen_at` column, no join table
   * (plan §21.7).
   */
  get isAwaitingCustomer() {
    return this.status === 'answered'
  }

  /**
   * In the back-office queue. `open` covers both a new ticket and one the
   * customer has come back to.
   */
  get isAwaitingUs() {
    return this.status === 'open'
  }
}
