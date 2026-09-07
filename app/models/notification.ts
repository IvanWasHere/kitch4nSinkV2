import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'

import { NotificationSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'
import { withSoftDelete } from '#models/mixins/with_soft_delete'

/**
 * A staff-authored announcement (plan §20).
 *
 * Deliberately has **no** "is this for me" method. Whether it applies to a
 * user is `app/notifications/audience.ts`, one pure function with exhaustive
 * tests — the single place a cross-tenant leak could come from, kept in one
 * place precisely so it can be tested that way rather than spread across a
 * model, a service and a view.
 */
export default class Notification extends compose(
  NotificationSchema,
  withPublicId('notification'),
  withSoftDelete
) {
  /**
   * Truthiness, not `!== null`: a column that was never assigned is
   * `undefined` on a freshly created model (CONTRIBUTING).
   */
  get isDraft() {
    return !this.publishedAt
  }

  get isExpired() {
    return Boolean(this.expiresAt) && this.expiresAt! <= DateTime.utc()
  }

  /**
   * Whether it is on somebody's screen right now — published, in date, and
   * not deleted. The audience question is separate and comes after this one.
   */
  get isLive() {
    return !this.isDraft && !this.isExpired && !this.deletedAt
  }

  get hasAction() {
    return Boolean(this.actionLabel) && Boolean(this.actionUrl)
  }

  /**
   * The plan keys or user ids this targets, whichever the type calls for.
   * Empty arrays rather than nulls so callers never branch on shape.
   */
  get planKeys(): string[] {
    return this.audience?.planKeys ?? []
  }

  get userIds(): number[] {
    return this.audience?.userIds ?? []
  }
}
