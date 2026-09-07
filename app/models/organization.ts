import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'
import { beforeCreate, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import { OrganizationSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'
import { withSoftDelete } from '#models/mixins/with_soft_delete'

/**
 * The tenant boundary. Every tenant-owned row belongs to exactly one
 * organisation, and every query against such a table filters on it.
 */
export default class Organization extends compose(
  OrganizationSchema,
  withPublicId('organization'),
  withSoftDelete
) {
  /**
   * Counters that the database defaults but the *instance* does not.
   *
   * A column with a `defaultTo(0)` is 0 in the row and `undefined` on the
   * model that just created it, because nothing assigned it — the same trap
   * as a never-assigned nullable timestamp (CONTRIBUTING). Left alone,
   * `storageUsedBytes + size` on a freshly registered workspace is `NaN`, and
   * a quota compared against `NaN` refuses every upload.
   */
  @beforeCreate()
  static initialiseCounters(organization: Organization) {
    organization.storageUsedBytes ??= 0
  }

  /**
   * The main user (D1). Nullable only for the instant between inserting the
   * organisation and inserting its owner, inside the registration
   * transaction — a committed organisation always has one.
   */
  @belongsTo(() => User, { foreignKey: 'ownerId' })
  declare owner: BelongsTo<typeof User>

  @hasMany(() => User)
  declare users: HasMany<typeof User>

  get isActive() {
    return this.status === 'active'
  }

  /**
   * `past_due` keeps the organisation usable — a failed payment shows a
   * banner, it does not lock people out of their own work (plan §7.5).
   * `suspended` is a staff action and is the only status that denies access.
   */
  get isSuspended() {
    return this.status === 'suspended'
  }

  get isOnTrial() {
    return Boolean(this.trialEndsAt) && this.trialEndsAt! > DateTime.utc()
  }
}
