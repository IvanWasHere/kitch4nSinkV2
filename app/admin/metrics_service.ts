import { DateTime } from 'luxon'

import User from '#models/user'
import Payment from '#models/payment'
import Subscription from '#models/subscription'
import Organization from '#models/organization'
import WebhookEvent from '#models/webhook_event'
import queue from '#queue/queue_service'
import { planFor } from '#config/plans'

export interface AdminMetrics {
  mrrCents: number
  activeSubscriptions: number
  pastDueSubscriptions: number
  trialingSubscriptions: number

  organizations: number
  signupsThisMonth: number
  signupsLastMonth: number

  canceledLast30Days: number
  churnRate: number | null

  failedJobs: number
  unprocessedWebhooks: number
  revenueThisMonthCents: number
}

/**
 * The numbers on the back-office dashboard (plan §12).
 *
 * Computed from our own tables rather than fetched from the payment
 * provider: this screen is opened when something is wrong, which is exactly
 * when an outbound call is least likely to answer. It is therefore *our*
 * view of the business — and where that disagrees with the provider,
 * `billing:sync` is the tool that says so.
 */
export class MetricsService {
  async collect(): Promise<AdminMetrics> {
    const [subscriptions, organizations, payments, jobCounts, webhooks] = await Promise.all([
      Subscription.all(),
      Organization.query().whereNull('deleted_at'),
      Payment.query().where('status', 'succeeded'),
      queue.counts(),
      WebhookEvent.query().whereNull('processed_at'),
    ])

    const now = DateTime.utc()
    const thisMonth = now.toFormat('yyyy-MM')
    const lastMonth = now.minus({ months: 1 }).toFormat('yyyy-MM')

    /**
     * MRR is the sum of the list price of every *entitling* subscription.
     *
     * Deliberately simple, and deliberately labelled on the screen as such:
     * it does not know about discounts, proration or annual plans, because
     * this application does not sell any of those yet. A number that quietly
     * pretended to account for them would be worse than one that says what
     * it is.
     *
     * `past_due` counts: the customer is still on the plan and we are still
     * trying to collect. Excluding them would make a dunning problem look
     * like churn.
     */
    const entitling = subscriptions.filter((subscription) => subscription.isEntitling)

    const mrrCents = entitling.reduce(
      (total, subscription) => total + planFor(subscription.planKey).priceCents,
      0
    )

    /**
     * Dates are compared from the models rather than in SQL, for the reason
     * CONTRIBUTING gives: a timestamp column compared against a bound value
     * means different things on SQLite and Postgres.
     */
    const signupsThisMonth = organizations.filter(
      (organization) => organization.createdAt.toUTC().toFormat('yyyy-MM') === thisMonth
    ).length

    const signupsLastMonth = organizations.filter(
      (organization) => organization.createdAt.toUTC().toFormat('yyyy-MM') === lastMonth
    ).length

    const thirtyDaysAgo = now.minus({ days: 30 })

    const canceledLast30Days = subscriptions.filter(
      (subscription) =>
        subscription.isCanceled &&
        subscription.canceledAt &&
        subscription.canceledAt >= thirtyDaysAgo
    ).length

    /**
     * Churn as cancellations over the subscriptions that could have
     * cancelled. Null rather than zero when there is nothing to divide by —
     * a shop with no customers has not retained them all.
     */
    const denominator = entitling.length + canceledLast30Days

    return {
      mrrCents,
      activeSubscriptions: subscriptions.filter((one) => one.status === 'active').length,
      pastDueSubscriptions: subscriptions.filter((one) => one.status === 'past_due').length,
      trialingSubscriptions: subscriptions.filter((one) => one.status === 'trialing').length,

      organizations: organizations.length,
      signupsThisMonth,
      signupsLastMonth,

      canceledLast30Days,
      churnRate: denominator === 0 ? null : canceledLast30Days / denominator,

      failedJobs: jobCounts.failed,
      unprocessedWebhooks: webhooks.length,

      revenueThisMonthCents: payments
        .filter((payment) => payment.occurredAt.toUTC().toFormat('yyyy-MM') === thisMonth)
        .reduce((total, payment) => total + payment.netAmountCents, 0),
    }
  }

  /**
   * Workspaces that need somebody to look at them, newest first.
   *
   * The dashboard's real job: not "how are we doing" but "what is broken
   * right now".
   */
  async needsAttention(limit = 10): Promise<Organization[]> {
    return Organization.query()
      .whereIn('status', ['past_due', 'suspended'])
      .whereNull('deleted_at')
      .orderBy('updated_at', 'desc')
      .limit(limit)
  }

  async recentSignups(limit = 10): Promise<User[]> {
    return User.query()
      .where('role', 'owner')
      .whereNull('deleted_at')
      .preload('organization')
      .orderBy('id', 'desc')
      .limit(limit)
  }
}

export default new MetricsService()
