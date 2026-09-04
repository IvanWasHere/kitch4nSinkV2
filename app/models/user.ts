import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { errors as authErrors } from '@adonisjs/auth'
import { compose } from '@adonisjs/core/helpers'
import { beforeSave, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

import Organization from '#models/organization'
import SocialAccount from '#models/social_account'
import { UserSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'
import { withSoftDelete } from '#models/mixins/with_soft_delete'

/**
 * A tenant user. Staff are a different table and a different guard (D5).
 */
export default class User extends compose(
  UserSchema,
  withPublicId('user'),
  withSoftDelete,
  withAuthFinder(hash, { uids: ['email'], passwordColumnName: 'password' })
) {
  /**
   * Case-insensitive email without `citext`: lowercase on the way in, plain
   * unique index in the database (plan §5.1, rule 5). Doing it in a hook
   * rather than at each call site is what makes it impossible to forget.
   */
  @beforeSave()
  static normaliseEmail(user: User) {
    if (user.$dirty.email && user.email) {
      user.email = user.email.trim().toLowerCase()
    }
  }

  /**
   * Verify credentials *and* that the account still exists.
   *
   * Removing a member soft-deletes them (plan §5.6), and a soft-deleted row
   * must not be a working set of credentials. The mixin's `verifyCredentials`
   * does not know about soft deletion, so every sign-in path goes through
   * this instead — and it fails with the same error, so a removed account is
   * indistinguishable from a wrong password.
   */
  static async verifyActiveCredentials(email: string, password: string): Promise<User> {
    const user = await this.verifyCredentials(email, password)

    if (user.isDeleted) {
      throw new authErrors.E_INVALID_CREDENTIALS('Invalid user credentials')
    }

    return user
  }

  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @hasMany(() => SocialAccount)
  declare socialAccounts: HasMany<typeof SocialAccount>

  get isOwner() {
    return this.role === 'owner'
  }

  get hasVerifiedEmail() {
    return Boolean(this.emailVerifiedAt)
  }

  /**
   * Two-factor counts as enabled only once a code has been confirmed. A
   * secret that was generated but never confirmed must not lock anyone out.
   */
  get hasTwoFactor() {
    return Boolean(this.twoFactorSecret) && Boolean(this.twoFactorConfirmedAt)
  }

  /**
   * An account created through Google or GitHub has no password until the
   * user sets one, and must not be told its (absent) password is wrong.
   */
  get hasPassword() {
    return Boolean(this.password)
  }

  get initials() {
    const source = this.fullName?.trim() || this.email.split('@')[0]
    const [first, second] = source.split(/[\s._-]+/)

    if (first && second) {
      return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
    }

    return source.slice(0, 2).toUpperCase()
  }

  get displayName() {
    return this.fullName?.trim() || this.email
  }

  async recordLogin() {
    this.lastLoginAt = DateTime.utc()
    await this.save()
  }
}
