import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import User from '#models/user'
import Invitation from '#models/invitation'
import Organization from '#models/organization'
import { hasSeatAvailable } from '#organizations/seats'

/**
 * How long an invitation stays open. Long enough to survive a holiday, short
 * enough that a forgotten link in an inbox is not a standing key to a
 * workspace.
 */
const LIFETIME = { days: 14 }

export class InvitationError extends Error {
  constructor(
    message: string,
    readonly reason:
      'seat_limit' | 'already_a_member' | 'belongs_to_another_workspace' | 'already_invited'
  ) {
    super(message)
  }
}

/**
 * Invitations: issuing, accepting, revoking.
 *
 * Only the sha256 hash of the token is stored — the invitation link grants
 * access to somebody's workspace, so a leaked database row must not be
 * replayable.
 */
export class InvitationService {
  /**
   * Invite an address to an organisation.
   *
   * Returns the plaintext token, which exists only here and in the email.
   */
  async invite(input: {
    organization: Organization
    invitedBy: User
    email: string
    role?: 'member'
  }): Promise<{ invitation: Invitation; token: string }> {
    const email = input.email.trim().toLowerCase()
    const token = randomBytes(32).toString('base64url')

    const invitation = await db.transaction(async (trx) => {
      await this.assertInvitable(input.organization, email, trx)

      /**
       * A previous invitation to the same address is superseded rather than
       * left alongside the new one, so "resend" cannot accumulate live links.
       *
       * This happens *before* the seat check: the invitation being replaced
       * already holds the seat, so counting it would make resending an
       * invitation impossible on a workspace that is at its cap — which is
       * exactly the workspace most likely to be resending one.
       */
      await Invitation.query({ client: trx })
        .where('organization_id', input.organization.id)
        .where('email', email)
        .whereNull('accepted_at')
        .whereNull('revoked_at')
        .update({ revoked_at: DateTime.utc().toSQL() })

      /**
       * The seat check runs inside the transaction that claims the seat, so
       * two simultaneous invitations to the last seat cannot both pass
       * (plan §5.5).
       */
      if (!(await hasSeatAvailable(input.organization, trx))) {
        throw new InvitationError(
          'This workspace has no seats left. Upgrade the plan or remove a member first.',
          'seat_limit'
        )
      }

      return Invitation.create(
        {
          organizationId: input.organization.id,
          email,
          role: input.role ?? 'member',
          tokenHash: this.hash(token),
          invitedByUserId: input.invitedBy.id,
          expiresAt: DateTime.utc().plus(LIFETIME),
        },
        { client: trx }
      )
    })

    return { invitation, token }
  }

  /**
   * Look an invitation up by its token without consuming it — used to render
   * the acceptance screen, or to explain why the link no longer works.
   */
  async findByToken(token: string): Promise<Invitation | null> {
    if (!token) {
      return null
    }

    return Invitation.query().where('token_hash', this.hash(token)).preload('organization').first()
  }

  /**
   * Accept an invitation, creating the user or attaching an existing one.
   *
   * The seat is re-checked inside this transaction: the invitation may have
   * been issued when there was room and accepted after the last seat went.
   */
  async accept(input: {
    token: string
    fullName?: string | null
    password?: string | null
    existingUser?: User | null
  }): Promise<User> {
    return db.transaction(async (trx) => {
      const invitation = await Invitation.query({ client: trx })
        .where('token_hash', this.hash(input.token))
        .forUpdate()
        .firstOrFail()

      if (!invitation.isPending) {
        throw new InvitationError('That invitation is no longer valid.', 'already_invited')
      }

      const organization = await Organization.query({ client: trx })
        .where('id', invitation.organizationId)
        .whereNull('deleted_at')
        .firstOrFail()

      /**
       * Consume the invitation before counting. Accepting *converts* the seat
       * this invitation already holds into a member seat — it does not claim
       * a second one — so the invitation must stop counting as pending first.
       */
      invitation.useTransaction(trx)
      invitation.acceptedAt = DateTime.utc()
      await invitation.save()

      /**
       * Re-checked here as well as at invite time: the invitation may have
       * been issued when there was room and accepted after the last seat
       * went to somebody else (plan §5.5).
       */
      if (!(await hasSeatAvailable(organization, trx))) {
        throw new InvitationError(
          'This workspace has no seats left. Ask the owner to free one up.',
          'seat_limit'
        )
      }

      const user =
        input.existingUser ??
        (await User.create(
          {
            organizationId: organization.id,
            role: invitation.role === 'owner' ? 'member' : invitation.role,
            email: invitation.email,
            password: input.password ?? null,
            fullName: input.fullName ?? null,
            /**
             * Following the link proves control of the mailbox it was sent
             * to, which is the same evidence a verification email asks for.
             */
            emailVerifiedAt: DateTime.utc(),
          },
          { client: trx }
        ))

      return user
    })
  }

  async revoke(invitation: Invitation): Promise<void> {
    if (!invitation.isPending) {
      return
    }

    invitation.revokedAt = DateTime.utc()
    await invitation.save()
  }

  /**
   * Three reasons an address cannot be invited, each with its own message.
   * "That address already belongs to another workspace" in particular is the
   * cost of one-organisation-per-user (D1) and must be said out loud rather
   * than failing silently (plan §5.4).
   */
  private async assertInvitable(
    organization: Organization,
    email: string,
    trx: TransactionClientContract
  ): Promise<void> {
    const existing = await User.query({ client: trx })
      .where('email', email)
      .whereNull('deleted_at')
      .first()

    if (existing) {
      if (existing.organizationId === organization.id) {
        throw new InvitationError(
          'That person is already a member of this workspace.',
          'already_a_member'
        )
      }

      throw new InvitationError(
        'That address already belongs to another workspace. Ask them to leave it first, or invite a different address.',
        'belongs_to_another_workspace'
      )
    }
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}

export default new InvitationService()
