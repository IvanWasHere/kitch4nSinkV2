import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'

import User from '#models/user'
import type Organization from '#models/organization'

export class MembershipError extends Error {
  constructor(
    message: string,
    readonly reason: 'last_member' | 'owner_cannot_leave' | 'not_a_member' | 'already_owner'
  ) {
    super(message)
  }
}

/**
 * Membership changes: removing someone, transferring ownership, leaving.
 *
 * All of these are one-way doors for the person on the receiving end, so each
 * refuses the case that would strand an organisation with no owner.
 */
export class MembershipService {
  /**
   * Remove a member. Owner-only (plan §6).
   *
   * The user is soft-deleted rather than erased: `created_by_user_id`
   * tombstones elsewhere in the schema point at them, and shared work must
   * survive someone leaving (plan §5.6).
   */
  async remove(organization: Organization, member: User): Promise<void> {
    if (member.organizationId !== organization.id) {
      throw new MembershipError('That person is not a member of this workspace.', 'not_a_member')
    }

    if (member.id === organization.ownerId) {
      throw new MembershipError(
        'The owner cannot be removed. Transfer ownership first.',
        'owner_cannot_leave'
      )
    }

    await member.softDelete()
  }

  /**
   * Move ownership to another member.
   *
   * There is exactly one owner: `organizations.owner_id` and the two `role`
   * columns move together inside one transaction, so the workspace is never
   * observed with two owners or none.
   */
  async transferOwnership(organization: Organization, from: User, to: User): Promise<void> {
    if (to.organizationId !== organization.id) {
      throw new MembershipError('That person is not a member of this workspace.', 'not_a_member')
    }

    if (to.id === from.id) {
      throw new MembershipError('You already own this workspace.', 'already_owner')
    }

    await db.transaction(async (trx) => {
      to.useTransaction(trx)
      to.role = 'owner'
      await to.save()

      from.useTransaction(trx)
      from.role = 'member'
      await from.save()

      organization.useTransaction(trx)
      organization.ownerId = to.id
      await organization.save()
    })
  }

  /**
   * Leave the workspace (plan §13.6.3 — the member-safe half of the mockup's
   * "delete account").
   *
   * The owner cannot simply leave: an organisation with no owner has nobody
   * who can pay for it, invite anyone, or delete it.
   */
  async leave(organization: Organization, user: User): Promise<void> {
    if (user.id === organization.ownerId) {
      throw new MembershipError(
        'Transfer ownership to someone else before leaving, or delete the workspace.',
        'owner_cannot_leave'
      )
    }

    await user.softDelete()
  }

  /**
   * Soft-delete an organisation and everyone in it. Owner-only, and the UI
   * asks for the workspace name to be typed first (plan §13.6.3).
   *
   * Nothing is erased. Whether deleted organisations are eventually purged
   * after a grace period is plan §19 Q2, still open — until it is answered,
   * the safe half is implemented and a staff member can restore the rows.
   */
  async deleteOrganization(organization: Organization): Promise<void> {
    await db.transaction(async (trx) => {
      const deletedAt = DateTime.utc().toSQL()

      await User.query({ client: trx })
        .where('organization_id', organization.id)
        .whereNull('deleted_at')
        .update({ deleted_at: deletedAt })

      organization.useTransaction(trx)
      organization.deletedAt = DateTime.utc()
      await organization.save()
    })
  }

  /**
   * Members of an organisation, owner first, then by name.
   *
   * Descending `role` puts 'owner' before 'member' alphabetically, which
   * avoids a CASE expression — raw SQL in application code is exactly what
   * portability rule 6 rules out.
   */
  async members(organization: Organization): Promise<User[]> {
    return User.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .orderBy('role', 'desc')
      .orderBy('full_name', 'asc')
  }
}

export default new MembershipService()
