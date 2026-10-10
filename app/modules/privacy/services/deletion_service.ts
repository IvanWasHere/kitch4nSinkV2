import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import User from '#models/user'
import type StaffUser from '#models/staff_user'
import Subscription from '#models/subscription'
import mailer from '#mail/mailer_service'
import queue from '#queue/queue_service'
import audit from '#audit/audit_service'
import privacyRegistry from '#privacy/registry'
import { DELETED_NAME, deletedEmailFor, isDeletedEmail } from '#privacy/deleted_identity'
import PrivacyRequest from '#modules/privacy/models/privacy_request'
import { PrivacyError } from '#modules/privacy/services/privacy_service'
import PrivacyDeletionConfirmNotification from '#modules/privacy/mails/privacy_deletion_confirm_notification'
import PrivacyDeletionRejectedNotification from '#modules/privacy/mails/privacy_deletion_rejected_notification'
import PrivacyDeletionCompletedNotification from '#modules/privacy/mails/privacy_deletion_completed_notification'
import '#modules/privacy/audit_actions'

/**
 * How long an emailed confirmation link works, for an account with no
 * password to confirm with.
 */
const CONFIRMATION_LIFETIME = { hours: 24 }

const FAILURE_REASON =
  'The deletion did not finish. Nothing was half-applied; the error is in the worker log.'

export type ConfirmationOutcome = 'confirmed' | 'already_confirmed' | 'expired' | 'invalid'

/**
 * What an admin needs to see before approving a deletion (plan §22.8.2).
 */
export interface DeletionReview {
  /**
   * Nobody else is in the workspace, so approving also deletes its lists,
   * todos and files.
   */
  lastMember: boolean

  /**
   * The workspace still has a subscription that charges. Deletion never
   * touches billing (D14), so it keeps charging until an admin cancels it.
   */
  activeSubscription: Subscription | null

  /**
   * The person owns the workspace, and this many other people are in it.
   * Approving deletes their accounts and the whole workspace with them.
   */
  otherMembers: number
}

/**
 * Account deletion (plan §22.8.2, D14).
 *
 *   requested → confirmed → approved → processing → completed
 *   (a person can cancel before approval; an admin can reject;
 *    a failed run can be retried)
 *
 * A user is **never physically deleted**. Their profile row is kept, with
 * its details overwritten by generic ones — the address becomes
 * `email<id>@deleteduser.com`, the name "Deleted User" — and the ways of
 * signing in cleared — and each feature's privacy contributor erases or
 * keeps its own rows under the same rules. Billing is never touched. Every
 * deletion waits for an admin.
 *
 * Deleting a workspace's **owner** deletes the workspace: every other member
 * goes the same way, and its lists, todos and files with them.
 */
export class DeletionService {
  async active(user: User): Promise<PrivacyRequest | null> {
    return PrivacyRequest.query()
      .where('user_id', user.id)
      .where('type', 'deletion')
      .whereIn('status', ['requested', 'confirmed', 'approved', 'processing'])
      .orderBy('id', 'desc')
      .first()
  }

  /**
   * How many other people go with this person: everybody else in the
   * workspace when they own it, nobody otherwise. Shown before they ask and
   * before an admin approves, and worked out again when the deletion runs.
   */
  async alsoDeleted(user: User): Promise<number> {
    return user.role === 'owner' ? this.otherMembers(user) : 0
  }

  /**
   * Ask to be deleted. With a password, it is confirmed on the spot by
   * re-entering it. Without one — an account that signs in with Google or
   * GitHub — a single-use link is emailed instead, so somebody at an unlocked
   * laptop cannot start it alone.
   *
   * At most one deletion is in progress per person; asking again returns it.
   */
  async request(
    user: User,
    input: { password?: string | null }
  ): Promise<{ request: PrivacyRequest; created: boolean; emailed: boolean }> {
    if (user.hasPassword && !(await hash.verify(user.password!, input.password ?? ''))) {
      throw new PrivacyError('That password is not right.')
    }

    const token = user.hasPassword ? null : randomBytes(32).toString('base64url')

    const result = await db.transaction(async (trx) => {
      await User.query({ client: trx }).where('id', user.id).forUpdate().firstOrFail()

      const existing = await PrivacyRequest.query({ client: trx })
        .where('user_id', user.id)
        .where('type', 'deletion')
        .whereIn('status', ['requested', 'confirmed', 'approved', 'processing'])
        .first()

      if (existing) {
        return { request: existing, created: false }
      }

      const now = DateTime.utc()
      const request = await PrivacyRequest.create(
        token
          ? {
              userId: user.id,
              type: 'deletion',
              status: 'requested',
              requestedAt: now,
              confirmationTokenHash: this.hash(token),
              confirmationExpiresAt: now.plus(CONFIRMATION_LIFETIME),
            }
          : {
              userId: user.id,
              type: 'deletion',
              status: 'confirmed',
              requestedAt: now,
              confirmedAt: now,
            },
        { client: trx }
      )

      return { request, created: true }
    })

    if (result.created && token) {
      await mailer.send(new PrivacyDeletionConfirmNotification(user, token))
    }

    return { ...result, emailed: result.created && Boolean(token) }
  }

  /**
   * Follow the emailed link. Locked while read and written, so the same link
   * followed twice at once confirms once.
   */
  async confirm(
    token: string
  ): Promise<{ outcome: ConfirmationOutcome; request?: PrivacyRequest }> {
    if (!token) {
      return { outcome: 'invalid' }
    }

    return db.transaction(async (trx) => {
      const request = await PrivacyRequest.query({ client: trx })
        .where('confirmation_token_hash', this.hash(token))
        .where('type', 'deletion')
        .forUpdate()
        .first()

      if (!request || ['cancelled', 'rejected'].includes(request.status)) {
        return { outcome: 'invalid' as const }
      }

      if (request.status !== 'requested') {
        return { outcome: 'already_confirmed' as const, request }
      }

      if (!request.confirmationExpiresAt || request.confirmationExpiresAt <= DateTime.utc()) {
        return { outcome: 'expired' as const, request }
      }

      request.useTransaction(trx)
      request.merge({
        status: 'confirmed',
        confirmedAt: DateTime.utc(),
        confirmationTokenHash: null,
        confirmationExpiresAt: null,
      })
      await request.save()

      return { outcome: 'confirmed' as const, request }
    })
  }

  /**
   * Changed their mind. Only before an admin has approved it — after that,
   * the work is already queued.
   */
  async cancel(request: PrivacyRequest): Promise<void> {
    if (!['requested', 'confirmed'].includes(request.status)) {
      throw new PrivacyError(
        'This request has already been approved and can no longer be cancelled.'
      )
    }

    request.merge({ status: 'cancelled', confirmationTokenHash: null, confirmationExpiresAt: null })
    await request.save()
  }

  async review(request: PrivacyRequest): Promise<DeletionReview> {
    return this.reviewUser(await User.findOrFail(request.userId))
  }

  async reviewUser(user: User): Promise<DeletionReview> {
    const [others, activeSubscription] = await Promise.all([
      this.otherMembers(user),
      Subscription.query()
        .where('organization_id', user.organizationId)
        .whereIn('status', [...Subscription.ENTITLING_STATUSES])
        .orderBy('id', 'desc')
        .first(),
    ])

    return {
      lastMember: others === 0,
      activeSubscription,
      otherMembers: user.role === 'owner' ? others : 0,
    }
  }

  /**
   * An admin's yes — the button that deletes the account. For a workspace's
   * owner that is the whole workspace and everybody in it, counted again
   * when the job runs rather than trusted from here.
   */
  async approve(request: PrivacyRequest, staff: StaffUser): Promise<void> {
    if (request.type !== 'deletion' || request.status !== 'confirmed') {
      throw new PrivacyError('Only a confirmed deletion request can be approved.')
    }

    await db.transaction(async (trx) => {
      request.useTransaction(trx)
      request.merge({
        status: 'approved',
        approvedAt: DateTime.utc(),
        processedByStaffId: staff.id,
      })
      await request.save()

      const { default: job } = await import('#modules/privacy/jobs/process_privacy_deletion_job')
      await queue.dispatch(job, { requestId: request.id }, { client: trx })
    })
  }

  /**
   * Staff deleting an account on the person's behalf — a request that came
   * in by email or ticket (plan §22.8.2). The admin's typed confirmation and
   * reason are the approval, so it is queued at once. Every other rule is the
   * same: an owner takes the workspace with them, billing is untouched.
   */
  async startByStaff(user: User, staff: StaffUser, reason: string): Promise<PrivacyRequest> {
    if (user.isDeleted) {
      throw new PrivacyError('That account has already been deleted.')
    }

    return db.transaction(async (trx) => {
      await User.query({ client: trx }).where('id', user.id).forUpdate().firstOrFail()

      const existing = await PrivacyRequest.query({ client: trx })
        .where('user_id', user.id)
        .where('type', 'deletion')
        .whereIn('status', ['requested', 'confirmed', 'approved', 'processing'])
        .first()

      if (existing) {
        throw new PrivacyError(
          `There is already a deletion request for this account (${existing.publicId}). Decide it on its page.`
        )
      }

      const now = DateTime.utc()
      const request = await PrivacyRequest.create(
        {
          userId: user.id,
          type: 'deletion',
          status: 'approved',
          requestedAt: now,
          confirmedAt: now,
          approvedAt: now,
          requestedByStaffId: staff.id,
          processedByStaffId: staff.id,
          staffNote: reason,
        },
        { client: trx }
      )

      const { default: job } = await import('#modules/privacy/jobs/process_privacy_deletion_job')
      await queue.dispatch(job, { requestId: request.id }, { client: trx })

      return request
    })
  }

  async reject(request: PrivacyRequest, staff: StaffUser, reason: string): Promise<void> {
    if (request.type !== 'deletion' || !['requested', 'confirmed'].includes(request.status)) {
      throw new PrivacyError('Only a deletion request waiting for review can be rejected.')
    }

    request.merge({
      status: 'rejected',
      rejectionReason: reason,
      processedByStaffId: staff.id,
      confirmationTokenHash: null,
      confirmationExpiresAt: null,
    })
    await request.save()

    const user = await User.find(request.userId)

    if (user) {
      await mailer.send(new PrivacyDeletionRejectedNotification(user, reason))
    }
  }

  /**
   * Run a failed deletion again. Safe: every step tolerates its rows
   * already being gone, and a failed run rolled its transaction back.
   */
  async retry(request: PrivacyRequest, staff: StaffUser): Promise<void> {
    if (request.type !== 'deletion' || request.status !== 'failed') {
      throw new PrivacyError('Only a failed deletion can be retried.')
    }

    await db.transaction(async (trx) => {
      request.useTransaction(trx)
      request.merge({ status: 'approved', failureReason: null, processedByStaffId: staff.id })
      await request.save()

      const { default: job } = await import('#modules/privacy/jobs/process_privacy_deletion_job')
      await queue.dispatch(job, { requestId: request.id }, { client: trx })
    })
  }

  /**
   * Run a deletion an admin has just approved, there and then, so the account
   * is gone when the page comes back rather than whenever a worker next
   * looks. The queued job stays as the safety net: if this attempt throws it
   * rolled back to an untouched account and the job tries again, and if it
   * worked the job finds a completed request and does nothing.
   */
  async runNow(request: PrivacyRequest): Promise<boolean> {
    try {
      await this.process(request.id, false)
    } catch {
      // Logged by `process`; the queued job retries it.
    }

    await request.refresh()
    return request.status === 'completed'
  }

  /**
   * The deletion itself — the job's whole body.
   *
   * One transaction: overwrite the user row first, then let every
   * registered contributor erase or keep its rows. Either all of it commits
   * or none of it does, and the stored files are only removed after the
   * commit. A crash part-way rolls back to an untouched account, and the
   * queue tries again.
   */
  async process(requestId: number, isFinalAttempt: boolean): Promise<void> {
    const request = await PrivacyRequest.find(requestId)

    if (
      !request ||
      request.type !== 'deletion' ||
      !['approved', 'processing'].includes(request.status)
    ) {
      return
    }

    const user = await User.find(request.userId)

    if (!user) {
      request.merge({ status: 'failed', failureReason: 'The account no longer exists.' })
      await request.save()
      return
    }

    request.status = 'processing'
    request.startedAt = request.startedAt ?? DateTime.utc()
    await request.save()

    const afterCommit: (() => Promise<void>)[] = []
    const alsoNotify: string[] = []
    let lastMember = false

    try {
      await db.transaction(async (trx) => {
        /**
         * Locking the workspace row serialises this against somebody joining
         * at the same moment, so who is in it is decided once and is true
         * when it is acted on.
         */
        await trx.from('organizations').where('id', user.organizationId).forUpdate().first()

        /**
         * An owner takes the workspace with them: everybody else in it is
         * deleted the same way, and its content goes as it does for a last
         * member — which, once they are gone, the owner is.
         */
        const others =
          user.role === 'owner'
            ? await User.query({ client: trx })
                .where('organization_id', user.organizationId)
                .whereNot('id', user.id)
                .whereNull('deleted_at')
                .orderBy('id')
            : []

        lastMember = others.length > 0 || (await this.otherMembers(user, trx)) === 0

        /**
         * The address the goodbye email goes to. Kept from the first run, so
         * a retry after the overwrite committed still knows it.
         */
        const originalEmail = request.notificationEmail ?? user.email

        request.useTransaction(trx)
        request.notificationEmail = isDeletedEmail(originalEmail) ? null : originalEmail
        await request.save()

        const context = {
          trx,
          lastMember,
          afterCommit: (work: () => Promise<void>) => afterCommit.push(work),
        }

        for (const member of others) {
          alsoNotify.push(member.email)
          await this.erase(member, { ...context, originalEmail: member.email })
        }

        /**
         * Their own requests to be deleted have now been honoured, by this one.
         */
        if (others.length) {
          const theirs = await PrivacyRequest.query({ client: trx })
            .whereIn(
              'user_id',
              others.map((member) => member.id)
            )
            .where('type', 'deletion')
            .whereIn('status', ['requested', 'confirmed'])

          for (const one of theirs) {
            one.merge({
              status: 'completed',
              completedAt: DateTime.utc(),
              confirmationTokenHash: null,
              confirmationExpiresAt: null,
            })
            await one.save()
          }
        }

        await this.erase(user, { ...context, originalEmail })
      })
    } catch (error) {
      logger.error(
        { err: error, event: 'privacy.deletion.failed', request: request.publicId },
        'could not delete an account'
      )

      if (!isFinalAttempt) {
        throw error
      }

      request.merge({ status: 'failed', failureReason: FAILURE_REASON })
      await request.save()

      await audit.recordSystemAction({
        action: 'privacy.deletion.failed',
        organization: { id: user.organizationId },
        subjectType: 'PrivacyRequest',
        subjectId: request.publicId,
      })
      return
    }

    for (const work of afterCommit) {
      await work().catch((error) =>
        logger.warn({ err: error, request: request.publicId }, 'cleanup after a deletion failed')
      )
    }

    const notify = request.notificationEmail

    request.merge({ status: 'completed', completedAt: DateTime.utc(), notificationEmail: null })
    await request.save()

    await audit.recordSystemAction({
      action: 'privacy.deletion.completed',
      organization: { id: user.organizationId },
      subjectType: 'PrivacyRequest',
      subjectId: request.publicId,
      metadata: { lastMember, membersDeleted: alsoNotify.length },
    })

    logger.info(
      {
        event: 'privacy.deletion.completed',
        request: request.publicId,
        lastMember,
        membersDeleted: alsoNotify.length,
      },
      'deleted an account'
    )

    if (notify) {
      await mailer.send(new PrivacyDeletionCompletedNotification(notify))
    }

    /**
     * The people who went with an owner are told too, and told why — they
     * did not ask. Their addresses were only ever held here, in memory.
     */
    for (const address of alsoNotify) {
      await mailer.send(new PrivacyDeletionCompletedNotification(address, 'workspace_deleted'))
    }
  }

  /**
   * One person's share of a deletion, inside its transaction: the profile
   * row first, then every registered contributor.
   *
   * The row is kept, with everything on it that says who the person was
   * overwritten by something generic: the address, the name, when they last
   * signed in. The ways of signing in are cleared. The avatar is a stored
   * file and goes with the files contributor, so the key pointing at it goes
   * here. Role and the dates the account was made and verified stay — they
   * are about the account, not the person.
   */
  private async erase(
    person: User,
    context: {
      trx: TransactionClientContract
      lastMember: boolean
      originalEmail: string
      afterCommit: (work: () => Promise<void>) => void
    }
  ): Promise<void> {
    person.useTransaction(context.trx)
    person.merge({
      email: deletedEmailFor(person.id),
      fullName: DELETED_NAME,
      lastLoginAt: null,
      notificationsSeenAt: null,
      password: null,
      avatarKey: null,
      twoFactorSecret: null,
      twoFactorRecoveryCodes: null,
      twoFactorConfirmedAt: null,
      deletedAt: person.deletedAt ?? DateTime.utc(),
    })
    await person.save()

    for (const contributor of privacyRegistry.all()) {
      await contributor.erase?.(person, context)
    }
  }

  private async otherMembers(user: User, trx?: TransactionClientContract) {
    const [row] = await User.query(trx ? { client: trx } : {})
      .where('organization_id', user.organizationId)
      .whereNot('id', user.id)
      .whereNull('deleted_at')
      .count('* as total')

    return Number(row.$extras.total)
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}

export default new DeletionService()
