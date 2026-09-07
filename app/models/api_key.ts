import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import Organization from '#models/organization'
import { ApiKeySchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'

/**
 * A key that authenticates an organisation, not a person (D4, plan §11).
 *
 * That distinction is the whole design: a key carries explicit scopes rather
 * than inheriting the role of whoever created it, so revoking the person who
 * made it does not change what the integration can do, and an integration
 * cannot quietly gain permissions when its author is promoted.
 */
export default class ApiKey extends compose(ApiKeySchema, withPublicId('apiKey')) {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'createdByUserId' })
  declare createdBy: BelongsTo<typeof User>

  get isRevoked() {
    /**
     * Truthiness, not `!== null`: a column that was never assigned is
     * `undefined` on a freshly created model (CONTRIBUTING).
     */
    return Boolean(this.revokedAt)
  }

  get isExpired() {
    return Boolean(this.expiresAt) && this.expiresAt! <= DateTime.utc()
  }

  get isActive() {
    return !this.isRevoked && !this.isExpired
  }

  can(scope: string): boolean {
    return (this.scopes ?? []).includes(scope as never)
  }
}
