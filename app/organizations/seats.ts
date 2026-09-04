import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import User from '#models/user'
import Invitation from '#models/invitation'
import type Organization from '#models/organization'
import { limitFor } from '#config/plans'

/**
 * Seat counting (plan §5.5).
 *
 * A seat is a member *or* an outstanding invitation. Counting only members
 * would let ten simultaneous invitations to a two-seat plan all succeed and
 * only bite when people started accepting — by which point the customer has
 * already told their team to expect access.
 */
export interface SeatUsage {
  members: number
  pendingInvitations: number
  used: number
  limit: number | null
  remaining: number | null
  isFull: boolean
}

export async function seatUsage(
  organization: Organization,
  trx?: TransactionClientContract
): Promise<SeatUsage> {
  const client = trx ? { client: trx } : {}

  const [members] = await User.query(client)
    .where('organization_id', organization.id)
    .whereNull('deleted_at')
    .count('* as total')

  /**
   * Expiry is filtered in memory rather than in SQL.
   *
   * Comparing a timestamp column against a bound value is exactly where the
   * two dialects differ — SQLite stores `YYYY-MM-DD HH:MM:SS` and compares it
   * as text, Postgres compares it as a timestamp — so a `where expires_at >
   * ?` here would quietly mean different things on the two engines. Deciding
   * it in one place, from the same `isPending` the model and the UI use, is
   * also what stops the count and the screen from disagreeing. The row count
   * is bounded by the seat limit, so there is nothing to gain from pushing it
   * down.
   */
  const openInvitations = await Invitation.query(client)
    .where('organization_id', organization.id)
    .whereNull('accepted_at')
    .whereNull('revoked_at')

  const memberCount = Number(members.$extras.total)
  const invitationCount = openInvitations.filter((invitation) => invitation.isPending).length
  const used = memberCount + invitationCount
  const limit = limitFor(organization, 'seats')

  return {
    members: memberCount,
    pendingInvitations: invitationCount,
    used,
    limit,
    remaining: limit === null ? null : Math.max(limit - used, 0),
    isFull: limit !== null && used >= limit,
  }
}

/**
 * Whether one more seat can be claimed.
 *
 * Callers must run this *inside* the transaction that claims the seat, so the
 * count they act on cannot change underneath them. Called outside one it is
 * only a hint for the UI.
 */
export async function hasSeatAvailable(
  organization: Organization,
  trx?: TransactionClientContract
): Promise<boolean> {
  const usage = await seatUsage(organization, trx)
  return usage.limit === null || usage.used < usage.limit
}
