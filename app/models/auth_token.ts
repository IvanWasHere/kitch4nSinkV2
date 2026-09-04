import { DateTime } from 'luxon'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import { AuthTokenSchema } from '#database/schema'

/**
 * A single-use token for email verification or password reset.
 *
 * Only the sha256 hash of the token is stored, so the table is useless to
 * anyone who reads it — see AuthTokenService, which owns issuing and
 * redeeming.
 */
export default class AuthToken extends AuthTokenSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  get isExpired() {
    return this.expiresAt <= DateTime.utc()
  }

  get isConsumed() {
    return this.consumedAt !== null
  }

  get isUsable() {
    return !this.isExpired && !this.isConsumed
  }
}
