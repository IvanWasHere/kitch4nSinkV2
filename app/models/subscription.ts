import { DateTime } from 'luxon'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Organization from '#models/organization'
import { SubscriptionSchema } from '#database/schema'

/**
 * A mirror of the subscription the provider owns (plan §7).
 *
 * Nothing in the application decides a status here — every column is written
 * from a normalized webhook or from a reconciliation fetch. Read it for the
 * billing screen and for support questions; read `organization.planKey` for
 * entitlements.
 */
export default class Subscription extends SubscriptionSchema {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  /**
   * Statuses that still entitle the organisation to its plan.
   *
   * `past_due` is deliberately included: a failed card shows a banner and
   * starts dunning, it does not take a customer's team out of their work
   * mid-sprint (plan §7.5). `paused` is not — a paused subscription is one
   * nobody is being charged for.
   */
  static readonly ENTITLING_STATUSES = ['trialing', 'active', 'past_due'] as const

  get isEntitling() {
    return (Subscription.ENTITLING_STATUSES as readonly string[]).includes(this.status)
  }

  get isCanceled() {
    return this.status === 'canceled' || this.status === 'expired'
  }

  /**
   * Scheduled to stop at the end of the period the customer has paid for.
   * They keep everything until then, which is what the billing screen has to
   * say rather than "canceled".
   */
  get isEndingSoon() {
    return this.cancelAtPeriodEnd && !this.isCanceled
  }

  get isOnTrial() {
    return (
      this.status === 'trialing' && Boolean(this.trialEndsAt) && this.trialEndsAt! > DateTime.utc()
    )
  }

  /**
   * The moment this row last learned something from the provider.
   *
   * Used as the ordering watermark in the webhook handler: events can arrive
   * out of order, and an event describing a state older than what we already
   * applied must not overwrite it (plan §7.5).
   */
  get watermark(): DateTime {
    return this.updatedAt ?? this.createdAt
  }
}
