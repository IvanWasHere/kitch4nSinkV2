import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { beforeSave } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'

import { StaffUserSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'

/**
 * Company staff — support and admin (D5).
 *
 * Kept in its own table and behind its own guard so a staff row can never be
 * returned by an organisation-scoped query, and so there is no column on
 * `users` that could be flipped to escalate a tenant into an administrator.
 */
export default class StaffUser extends compose(
  StaffUserSchema,
  withPublicId('staffUser'),
  withAuthFinder(hash, { uids: ['email'], passwordColumnName: 'password' })
) {
  @beforeSave()
  static normaliseEmail(staff: StaffUser) {
    if (staff.$dirty.email && staff.email) {
      staff.email = staff.email.trim().toLowerCase()
    }
  }

  get isAdmin() {
    return this.role === 'admin'
  }

  get isDisabled() {
    return this.disabledAt !== null
  }

  /**
   * Two-factor is mandatory for staff (plan §12); the guard middleware sends
   * anyone without it to the setup screen before any admin route runs.
   */
  get hasTwoFactor() {
    return this.twoFactorSecret !== null && this.twoFactorConfirmedAt !== null
  }

  get initials() {
    const source = this.fullName?.trim() || this.email.split('@')[0]
    const [first, second] = source.split(/[\s._-]+/)

    if (first && second) {
      return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase()
    }

    return source.slice(0, 2).toUpperCase()
  }

  async recordLogin() {
    this.lastLoginAt = DateTime.utc()
    await this.save()
  }
}
