import { compose } from '@adonisjs/core/helpers'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

import File from '#models/file'
import User from '#models/user'
import StaffUser from '#models/staff_user'
import SupportTicket from '#models/support_ticket'
import { SupportMessageSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'

/**
 * One message in a support conversation (plan §21.2).
 *
 * `authorUserId` and `authorStaffId` are a pair with exactly one side set —
 * tenant users and staff are separate tables behind separate guards (D5), so
 * a single polymorphic author id would be a foreign key to nowhere.
 */
export default class SupportMessage extends compose(
  SupportMessageSchema,
  withPublicId('supportMessage')
) {
  @belongsTo(() => SupportTicket, { foreignKey: 'supportTicketId' })
  declare ticket: BelongsTo<typeof SupportTicket>

  @belongsTo(() => User, { foreignKey: 'authorUserId' })
  declare authorUser: BelongsTo<typeof User>

  @belongsTo(() => StaffUser, { foreignKey: 'authorStaffId' })
  declare authorStaff: BelongsTo<typeof StaffUser>

  /**
   * Images and PDFs attached to this message (plan §21.3). Polymorphic on
   * `files`, the same mechanism avatars and workspace logos use.
   */
  @hasMany(() => File, { foreignKey: 'attachableId' })
  declare attachments: HasMany<typeof File>

  get isFromStaff() {
    return this.authorType === 'staff'
  }

  /**
   * Who to show above the bubble. Staff are shown by name rather than by
   * address: a customer has no use for an internal email, and it is one less
   * thing to leak.
   */
  get authorName(): string {
    if (this.isFromStaff) {
      return this.authorStaff?.fullName ?? 'Support'
    }

    return this.authorUser?.displayName ?? 'Someone'
  }

  get authorInitials(): string {
    if (this.isFromStaff) {
      return this.authorStaff?.initials ?? 'S'
    }

    return this.authorUser?.initials ?? '?'
  }
}
