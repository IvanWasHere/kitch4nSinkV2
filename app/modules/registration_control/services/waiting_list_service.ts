import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

import User from '#models/user'
import mailer from '#mail/mailer_service'
import settings from '#settings/settings_service'
import WaitingListEntry from '#modules/registration_control/models/waiting_list_entry'
import WaitingListConfirmationNotification from '#modules/registration_control/mails/waiting_list_confirmation_notification'

/**
 * How long a confirmation link works. Generous, like email verification:
 * people read mail late, and the cost of an expired link is joining again.
 */
const CONFIRMATION_LIFETIME = { hours: 48 }

export type ConfirmationOutcome = 'confirmed' | 'already_confirmed' | 'expired' | 'invalid'

export const WAITING_LIST_STATUSES = [
  'pending_confirmation',
  'confirmed',
  'converted',
  'cancelled',
] as const

export type WaitingListStatus = (typeof WAITING_LIST_STATUSES)[number]

/**
 * Why a staff action was refused — shown to the staff member as-is.
 */
export class WaitingListError extends Error {}

/**
 * The waiting list (plan §22.5).
 *
 * `join` never tells its caller what happened. Whether the address was new,
 * already queued, or already an account, the person sees the same sentence —
 * otherwise this form answers "does this address have an account?" for
 * anybody who asks it. That is why it returns nothing.
 */
export class WaitingListService {
  async join(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase()

    /**
     * An existing account — including a removed one, whose address is still
     * taken — gets nothing: no entry, and no email. "You already have an
     * account" sent to the address would be the leak in another form; the
     * sign-in and forgot-password pages are where that person goes.
     */
    if (await User.findBy('email', email)) {
      return
    }

    const existing = await WaitingListEntry.findBy('email', email)

    if (existing) {
      /**
       * Joining again before confirming is the "I never got the email" path,
       * so it sends a fresh link. Every other state is left exactly as it
       * is — a cancelled entry stays cancelled, whatever the visitor wants.
       */
      if (existing.isPending && existing.doubleOptInRequired) {
        await this.sendConfirmation(existing)
      }

      return
    }

    const doubleOptIn = await settings.get('waiting_list_double_opt_in')

    let entry: WaitingListEntry

    try {
      entry = await WaitingListEntry.create({
        email,
        status: doubleOptIn ? 'pending_confirmation' : 'confirmed',
        doubleOptInRequired: doubleOptIn,
        confirmedAt: doubleOptIn ? null : DateTime.utc(),
      })
    } catch (error) {
      /**
       * Two submissions of the same address racing each other: the unique
       * index let one in, and the other has nothing left to do.
       */
      if (await WaitingListEntry.findBy('email', email)) {
        return
      }

      throw error
    }

    logger.info({ event: 'waiting_list.created', entry: entry.publicId }, 'joined the waiting list')

    if (doubleOptIn) {
      await this.sendConfirmation(entry)
    }
  }

  /**
   * Follow a confirmation link.
   *
   * The row is locked while it is read and written, so the same link
   * followed twice at once confirms once. A link followed again afterwards is
   * reported as already confirmed rather than invalid — the person did
   * nothing wrong by clicking twice.
   */
  async confirm(token: string): Promise<ConfirmationOutcome> {
    if (!token) {
      return 'invalid'
    }

    return db.transaction(async (trx) => {
      const entry = await WaitingListEntry.query({ client: trx })
        .where('confirmation_token_hash', this.hash(token))
        .forUpdate()
        .first()

      if (!entry || entry.status === 'cancelled') {
        return 'invalid'
      }

      if (!entry.isPending) {
        return 'already_confirmed'
      }

      if (entry.isConfirmationExpired) {
        return 'expired'
      }

      entry.useTransaction(trx)
      entry.status = 'confirmed'
      entry.confirmedAt = DateTime.utc()
      await entry.save()

      logger.info(
        { event: 'waiting_list.confirmed', entry: entry.publicId },
        'confirmed a waiting-list entry'
      )

      return 'confirmed'
    })
  }

  /**
   * The admin list, newest first, optionally narrowed to one status.
   * Database-paginated: the list is the one table here that grows with
   * public traffic rather than with customers.
   */
  async page(filters: { status: WaitingListStatus | null; page: number; perPage?: number }) {
    const query = WaitingListEntry.query().orderBy('created_at', 'desc').orderBy('id', 'desc')

    if (filters.status) {
      query.where('status', filters.status)
    }

    return query.paginate(filters.page, filters.perPage ?? 50)
  }

  /**
   * How many entries are in each state, for the filter pills. One grouped
   * query rather than four counts.
   */
  async counts(): Promise<Record<WaitingListStatus | 'all', number>> {
    const rows = await WaitingListEntry.query()
      .select('status')
      .count('* as total')
      .groupBy('status')

    const counts = { all: 0, pending_confirmation: 0, confirmed: 0, converted: 0, cancelled: 0 }

    for (const row of rows) {
      const total = Number(row.$extras.total)
      counts[row.status] = total
      counts.all += total
    }

    return counts
  }

  async findByPublicId(publicId: string): Promise<WaitingListEntry | null> {
    return WaitingListEntry.findBy('public_id', publicId)
  }

  /**
   * Take somebody off the list. Their confirmation link stops working, and
   * joining again with the same address does not put them back — a cancel is
   * a staff decision, and the public form is not a way round it.
   */
  async cancel(entry: WaitingListEntry): Promise<void> {
    if (entry.status === 'cancelled') {
      throw new WaitingListError('That entry is already cancelled.')
    }

    entry.status = 'cancelled'
    entry.confirmationTokenHash = null
    entry.confirmationExpiresAt = null
    await entry.save()
  }

  /**
   * Record that this person now has an account. By hand for now; a nightly
   * job will do it for addresses that sign up on their own (plan §22.5).
   */
  async markConverted(entry: WaitingListEntry): Promise<void> {
    if (entry.status === 'converted') {
      throw new WaitingListError('That entry is already marked as converted.')
    }

    if (entry.status === 'cancelled') {
      throw new WaitingListError('A cancelled entry cannot be marked as converted.')
    }

    entry.status = 'converted'
    entry.convertedAt = DateTime.utc()
    entry.confirmationTokenHash = null
    entry.confirmationExpiresAt = null
    await entry.save()
  }

  /**
   * Send the confirmation email again — the "they say it never arrived"
   * ticket. Only for an entry that is still waiting to be confirmed, and
   * only under double opt-in: there is nothing to confirm otherwise.
   */
  async resendConfirmation(entry: WaitingListEntry): Promise<void> {
    if (!entry.isPending || !entry.doubleOptInRequired) {
      throw new WaitingListError(
        'Only an entry waiting for confirmation can be sent the link again.'
      )
    }

    await this.sendConfirmation(entry)
  }

  /**
   * Remove the row entirely — for an address that should never have been
   * there. Unlike cancel, the address can join again afterwards.
   */
  async delete(entry: WaitingListEntry): Promise<void> {
    await entry.delete()
  }

  /**
   * Issue a new token, retiring the previous one, and queue the email. Only
   * the hash is stored; the token exists once, in the message.
   */
  private async sendConfirmation(entry: WaitingListEntry): Promise<void> {
    const token = randomBytes(32).toString('base64url')

    entry.confirmationTokenHash = this.hash(token)
    entry.confirmationExpiresAt = DateTime.utc().plus(CONFIRMATION_LIFETIME)
    await entry.save()

    await mailer.send(new WaitingListConfirmationNotification(entry.email, token))
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}

export default new WaitingListService()
