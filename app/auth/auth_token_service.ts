import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'

import User from '#models/user'
import AuthToken from '#models/auth_token'

export type AuthTokenType = 'verify_email' | 'reset_password'

/**
 * How long each kind of token stays valid. Verification links are generous
 * because people read email late; reset links are short because a reset link
 * sitting in an inbox is a standing key to the account.
 */
const LIFETIMES: Record<AuthTokenType, { hours: number }> = {
  verify_email: { hours: 48 },
  reset_password: { hours: 1 },
}

/**
 * Issues and redeems the single-use tokens behind email verification and
 * password reset.
 *
 * Only the sha256 hash of a token is stored. The plaintext exists once, in
 * the email that is sent, and nowhere else — so a leaked database row is not
 * a way into an account.
 */
export class AuthTokenService {
  /**
   * Issue a token for a user, invalidating any outstanding token of the same
   * type. Requesting a new reset link must retire the previous one, otherwise
   * every request a user makes leaves another working key behind.
   *
   * Returns the plaintext token — the only time it exists.
   */
  async issue(user: User, type: AuthTokenType): Promise<string> {
    const token = randomBytes(32).toString('base64url')

    await db.transaction(async (trx) => {
      await AuthToken.query({ client: trx })
        .where('user_id', user.id)
        .where('type', type)
        .whereNull('consumed_at')
        .update({ consumed_at: DateTime.utc().toSQL() })

      await AuthToken.create(
        {
          userId: user.id,
          type,
          tokenHash: this.hash(token),
          expiresAt: DateTime.utc().plus(LIFETIMES[type]),
        },
        { client: trx }
      )
    })

    return token
  }

  /**
   * Redeem a token, returning the user it belongs to.
   *
   * The lookup and the consumption happen in one transaction with the row
   * locked, so following the same reset link twice in parallel cannot reset
   * the password twice.
   */
  async consume(token: string, type: AuthTokenType): Promise<User | null> {
    if (!token) {
      return null
    }

    return db.transaction(async (trx) => {
      const record = await AuthToken.query({ client: trx })
        .where('token_hash', this.hash(token))
        .where('type', type)
        .whereNull('consumed_at')
        .forUpdate()
        .first()

      if (!record || record.isExpired) {
        return null
      }

      record.useTransaction(trx)
      record.consumedAt = DateTime.utc()
      await record.save()

      return User.query({ client: trx }).where('id', record.userId).whereNull('deleted_at').first()
    })
  }

  /**
   * Look a token up without consuming it — used to decide whether to render
   * the "set a new password" form or the "this link has expired" screen.
   */
  async find(token: string, type: AuthTokenType): Promise<AuthToken | null> {
    if (!token) {
      return null
    }

    const record = await AuthToken.query()
      .where('token_hash', this.hash(token))
      .where('type', type)
      .first()

    return record && record.isUsable ? record : null
  }

  /**
   * Constant-time comparison, for the rare case where a caller holds two
   * plaintext values rather than a stored hash.
   */
  matches(token: string, otherToken: string): boolean {
    const a = Buffer.from(this.hash(token), 'hex')
    const b = Buffer.from(this.hash(otherToken), 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }
}

export default new AuthTokenService()
