import { DateTime } from 'luxon'

import User from '#models/user'
import Payment from '#models/payment'
import Subscription from '#models/subscription'
import Organization from '#models/organization'
import WebhookEvent from '#models/webhook_event'
import queue from '#queue/queue_service'
import { planFor, plans as planCatalogue, DEFAULT_PLAN } from '#config/plans'

/**
 * One figure with the same figure a month earlier beside it. The direction is
 * computed here rather than in the template so that "did it go up" is decided
 * once, and so the sign is never derived from a rounded percentage.
 */
export interface GrowthFigure {
  value: number
  previous: number

  /** Always positive — `direction` carries the sign. */
  difference: number
  direction: 'up' | 'down' | 'flat'
}

export interface GrowthMonth {
  key: string
  label: string
  registered: number

  /** Height of the bar as a percentage of the busiest month in the window. */
  heightPercent: number

  /** The month still running: its bar is drawn hatched, not solid. */
  isCurrent: boolean
}

export interface PlanShare {
  key: string
  name: string
  count: number
  percent: number
  isPaid: boolean
}

/**
 * How the business moved, as opposed to what it is worth right now
 * (`AdminMetrics`). Four events, counted per calendar month in UTC:
 *
 *   registered     a workspace was created
 *   startedPaying  a workspace's *first* successful payment landed
 *   renewals       a successful payment that was not a workspace's first
 *   churned        a subscription was cancelled or expired
 *
 * "Started paying" and "renewals" are deliberately payment-shaped rather than
 * subscription-shaped: a subscription row says what somebody signed up for,
 * and a payment says what they actually paid, which is the number anybody
 * looking at this screen means.
 */
export interface GrowthMetrics {
  registered: GrowthFigure
  startedPaying: GrowthFigure
  renewals: GrowthFigure
  churned: GrowthFigure

  months: GrowthMonth[]
  registeredInWindow: number
  busiestMonth: number
  monthlyAverage: number

  planMix: PlanShare[]
  payingWorkspaces: number
  payingPercent: number
}

export type RevenueRange = '7d' | '30d' | '90d'

/**
 * A money figure with the same figure over the period before it. Cents, not
 * a formatted string: money becomes a decimal at the edge and nowhere else
 * (portability rule 8).
 */
export interface MoneyFigure {
  cents: number
  previousCents: number

  /** Always positive — `direction` carries the sign. */
  differenceCents: number
  direction: 'up' | 'down' | 'flat'

  /**
   * Magnitude of the change, like `differenceCents`. Null when the previous
   * period was zero: there is nothing to divide by.
   */
  percent: number | null
}

export interface RevenueBucket {
  label: string
  cents: number
  heightPercent: number
}

export interface RevenuePlanShare {
  key: string
  name: string
  cents: number
  percent: number
}

/**
 * What moved through the account over a window (plan §12), as opposed to what
 * it recurs at (`AdminMetrics.mrrCents`).
 *
 *   gross     every charge in the window, before anything was given back
 *   refunded  what was given back, from the same rows
 *   net       gross minus refunded — what the sales actually left behind
 *
 * A disputed charge stays in gross until the provider records the refund,
 * because until then nobody knows which way it will go.
 *
 * These are *our* rows, not the provider's ledger: they say what customers
 * were charged, not what has settled into a bank account. The balance a
 * payout lands from lives at the provider and this application never calls
 * it — see `billing:sync` for the tool that compares the two.
 */
export interface RevenueMetrics {
  range: RevenueRange
  days: number

  /**
   * Cents are only comparable within one currency, so every figure here is
   * the dominant one in the window and anything else is listed separately
   * rather than quietly added in.
   */
  currency: string
  otherCurrencies: { currency: string; netCents: number }[]

  gross: MoneyFigure
  net: MoneyFigure
  refunded: MoneyFigure

  /** Polyline points for a 100×30 viewBox, oldest day first. */
  sparkGross: string
  sparkNet: string
  sparkRefunded: string

  buckets: RevenueBucket[]
  bucketsAreWeekly: boolean

  byPlan: RevenuePlanShare[]
  collectedAllTimeCents: number
  refundedAllTimeCents: number
}

export const REVENUE_RANGES: Record<RevenueRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

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
 * A series as `points` for a 100×30 SVG polyline, oldest value on the left.
 *
 * Normalised to its own maximum: a sparkline says "what shape", never "how
 * much", and the number it sits beside is the one that says how much. A flat
 * series draws along the bottom rather than through the middle, so "nothing
 * happened" does not look like "steady".
 */
function sparkline(values: number[]): string {
  if (values.length === 0) {
    return ''
  }

  const highest = Math.max(...values, 0)
  const lastIndex = Math.max(1, values.length - 1)

  return values
    .map((value, index) => {
      const x = (index / lastIndex) * 100
      const y = highest === 0 ? 29 : 29 - (value / highest) * 28

      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
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
   * Volume through the account over 7, 30 or 90 days, with the same window
   * before it to compare against (plan §12).
   *
   * Every charge row counts toward gross, including one that was later
   * refunded: a refund does not delete the sale, it subtracts from it. That
   * is why this reads all payments rather than `status = 'succeeded'` the way
   * `collect()` does for its month-to-date figure.
   */
  async revenue(range: RevenueRange = '30d'): Promise<RevenueMetrics> {
    const days = REVENUE_RANGES[range] ?? REVENUE_RANGES['30d']

    const [payments, subscriptions, organizations] = await Promise.all([
      Payment.query().orderBy('occurred_at', 'asc'),
      Subscription.all(),
      Organization.query(),
    ])

    const now = DateTime.utc()
    const windowStart = now.minus({ days })
    const previousStart = now.minus({ days: days * 2 })

    const inWindow = payments.filter((payment) => payment.occurredAt.toUTC() >= windowStart)
    const inPrevious = payments.filter(
      (payment) =>
        payment.occurredAt.toUTC() >= previousStart && payment.occurredAt.toUTC() < windowStart
    )

    /**
     * The currency with the most volume in the window carries the headline.
     * Adding minor units across currencies would produce a number that is
     * wrong in every one of them.
     */
    const volumeByCurrency = new Map<string, number>()
    for (const payment of inWindow) {
      const currency = payment.currency.toUpperCase()
      volumeByCurrency.set(currency, (volumeByCurrency.get(currency) ?? 0) + payment.netAmountCents)
    }

    const ranked = [...volumeByCurrency.entries()].sort(([, a], [, b]) => b - a)
    const currency = ranked[0]?.[0] ?? 'USD'
    const otherCurrencies = ranked
      .slice(1)
      .map(([code, netCents]) => ({ currency: code, netCents }))

    const ofCurrency = (rows: Payment[]) =>
      rows.filter((payment) => payment.currency.toUpperCase() === currency)

    const window = ofCurrency(inWindow)
    const previous = ofCurrency(inPrevious)

    const sum = (rows: Payment[], of: (payment: Payment) => number) =>
      rows.reduce((total, payment) => total + of(payment), 0)

    const figure = (rows: Payment[], before: Payment[], of: (payment: Payment) => number) => {
      const cents = sum(rows, of)
      const previousCents = sum(before, of)
      const differenceCents = cents - previousCents

      return {
        cents,
        previousCents,
        differenceCents: Math.abs(differenceCents),
        direction: (differenceCents === 0 ? 'flat' : differenceCents > 0 ? 'up' : 'down') as
          'up' | 'down' | 'flat',
        percent: previousCents === 0 ? null : Math.abs((differenceCents / previousCents) * 100),
      }
    }

    /**
     * One value per day of the window, oldest first — the shape both the
     * sparklines and the chart are built from.
     */
    const startOfDay = now.startOf('day')
    const dailyGross: number[] = []
    const dailyNet: number[] = []
    const dailyRefunded: number[] = []
    const dayStarts: DateTime[] = []

    for (let back = days - 1; back >= 0; back--) {
      const day = startOfDay.minus({ days: back })
      const next = day.plus({ days: 1 })
      const rows = window.filter(
        (payment) => payment.occurredAt.toUTC() >= day && payment.occurredAt.toUTC() < next
      )

      dayStarts.push(day)
      dailyGross.push(sum(rows, (payment) => payment.amountCents))
      dailyNet.push(sum(rows, (payment) => payment.netAmountCents))
      dailyRefunded.push(sum(rows, (payment) => payment.refundedAmountCents))
    }

    /**
     * Ninety daily bars are unreadable at any width a card gets, so the
     * longest range is bucketed by week. The other two stay daily, because
     * "which day did that come in on" is the question they are opened with.
     */
    const bucketsAreWeekly = days > 31
    const bucketSize = bucketsAreWeekly ? 7 : 1

    const totals: { label: string; cents: number }[] = []
    for (let index = 0; index < dailyNet.length; index += bucketSize) {
      const slice = dailyNet.slice(index, index + bucketSize)
      totals.push({
        label: dayStarts[index].toFormat(bucketsAreWeekly ? 'd LLL' : days > 7 ? 'd' : 'ccc'),
        cents: slice.reduce((total, value) => total + value, 0),
      })
    }

    const busiest = totals.reduce((most, bucket) => Math.max(most, bucket.cents), 0)

    const buckets: RevenueBucket[] = totals.map((bucket) => ({
      ...bucket,
      heightPercent:
        busiest === 0 || bucket.cents <= 0
          ? 0
          : Math.max(2, Math.round((bucket.cents / busiest) * 100)),
    }))

    /**
     * What a payment bought: the plan its subscription was on, falling back to
     * the workspace's plan for a charge that has no subscription behind it.
     */
    const planOfSubscription = new Map(
      subscriptions.map((subscription) => [subscription.id, subscription.planKey])
    )
    const planOfOrganization = new Map(
      organizations.map((organization) => [organization.id, organization.planKey])
    )

    const netByPlan = new Map<string, number>()
    for (const payment of window) {
      const key =
        (payment.subscriptionId ? planOfSubscription.get(payment.subscriptionId) : undefined) ??
        planOfOrganization.get(payment.organizationId) ??
        DEFAULT_PLAN

      netByPlan.set(key, (netByPlan.get(key) ?? 0) + payment.netAmountCents)
    }

    const netInWindow = sum(window, (payment) => payment.netAmountCents)

    const byPlan: RevenuePlanShare[] = Object.keys(planCatalogue)
      .map((key) => ({
        key,
        name: planFor(key).name,
        cents: netByPlan.get(key) ?? 0,
        percent: netInWindow === 0 ? 0 : ((netByPlan.get(key) ?? 0) / netInWindow) * 100,
      }))
      .filter((plan) => plan.cents > 0)

    const allTime = ofCurrency(payments)

    return {
      range,
      days,
      currency,
      otherCurrencies,

      gross: figure(window, previous, (payment) => payment.amountCents),
      net: figure(window, previous, (payment) => payment.netAmountCents),
      refunded: figure(window, previous, (payment) => payment.refundedAmountCents),

      sparkGross: sparkline(dailyGross),
      sparkNet: sparkline(dailyNet),
      sparkRefunded: sparkline(dailyRefunded),

      buckets,
      bucketsAreWeekly,

      byPlan,
      collectedAllTimeCents: sum(allTime, (payment) => payment.netAmountCents),
      refundedAllTimeCents: sum(allTime, (payment) => payment.refundedAmountCents),
    }
  }

  /**
   * Movement rather than position: who arrived, who started paying, who paid
   * again, and who left (plan §12).
   *
   * Rows are loaded and counted in JavaScript for the same reason `collect()`
   * does it — a timestamp column compared against a bound value means
   * different things on SQLite and Postgres, and this screen has to give the
   * same answer on both. The window is twelve months of a back-office table,
   * not a reporting warehouse; when that stops being true this is the method
   * to move behind a rollup table.
   */
  async growth(monthsBack = 12): Promise<GrowthMetrics> {
    const [organizations, subscriptions, payments] = await Promise.all([
      Organization.query().whereNull('deleted_at'),
      Subscription.all(),
      Payment.query().where('status', 'succeeded').orderBy('occurred_at', 'asc'),
    ])

    const now = DateTime.utc()
    const monthOf = (moment: DateTime) => moment.toUTC().toFormat('yyyy-MM')
    const thisMonth = monthOf(now)
    const lastMonth = monthOf(now.minus({ months: 1 }))

    /**
     * A workspace's first successful payment is what turns it from a signup
     * into a customer; every payment after it is a renewal. Both are derived
     * from the same ordered list so a month can never count one payment as
     * both.
     */
    const firstPaymentMonth = new Map<number, string>()
    const renewalsByMonth = new Map<string, number>()
    const startedPayingByMonth = new Map<string, number>()

    for (const payment of payments) {
      const month = monthOf(payment.occurredAt)

      if (firstPaymentMonth.has(payment.organizationId)) {
        renewalsByMonth.set(month, (renewalsByMonth.get(month) ?? 0) + 1)
        continue
      }

      firstPaymentMonth.set(payment.organizationId, month)
      startedPayingByMonth.set(month, (startedPayingByMonth.get(month) ?? 0) + 1)
    }

    const registeredByMonth = new Map<string, number>()
    for (const organization of organizations) {
      const month = monthOf(organization.createdAt)
      registeredByMonth.set(month, (registeredByMonth.get(month) ?? 0) + 1)
    }

    const churnedByMonth = new Map<string, number>()
    for (const subscription of subscriptions) {
      if (!subscription.isCanceled || !subscription.canceledAt) {
        continue
      }

      const month = monthOf(subscription.canceledAt)
      churnedByMonth.set(month, (churnedByMonth.get(month) ?? 0) + 1)
    }

    const figure = (counts: Map<string, number>): GrowthFigure => {
      const value = counts.get(thisMonth) ?? 0
      const previous = counts.get(lastMonth) ?? 0
      const difference = value - previous

      return {
        value,
        previous,
        difference: Math.abs(difference),
        direction: difference === 0 ? 'flat' : difference > 0 ? 'up' : 'down',
      }
    }

    /**
     * Oldest first, one entry per month whether or not anything happened in
     * it — a chart that skips empty months makes a quiet quarter look busy.
     */
    const window: { key: string; label: string; registered: number }[] = []
    for (let back = monthsBack - 1; back >= 0; back--) {
      const moment = now.minus({ months: back })
      const key = monthOf(moment)

      window.push({
        key,
        label: moment.toFormat('LLL'),
        registered: registeredByMonth.get(key) ?? 0,
      })
    }

    const busiestMonth = window.reduce((most, month) => Math.max(most, month.registered), 0)

    const months: GrowthMonth[] = window.map((month) => ({
      ...month,
      /**
       * A month with one signup in a window whose best month had forty still
       * has to be visible, so the floor is 2% rather than 0.
       */
      heightPercent:
        busiestMonth === 0 || month.registered === 0
          ? 0
          : Math.max(2, Math.round((month.registered / busiestMonth) * 100)),
      isCurrent: month.key === thisMonth,
    }))

    const registeredInWindow = window.reduce((total, month) => total + month.registered, 0)

    /**
     * Plan mix is counted from `organizations.planKey` — what a workspace is
     * entitled to right now — rather than from subscription rows, because an
     * override or a cancelled-but-still-running plan is the entitlement the
     * customer actually has.
     */
    const planMix: PlanShare[] = Object.keys(planCatalogue).map((key) => {
      const count = organizations.filter((organization) => organization.planKey === key).length

      return {
        key,
        name: planFor(key).name,
        count,
        percent: organizations.length === 0 ? 0 : (count / organizations.length) * 100,
        isPaid: planFor(key).priceCents > 0,
      }
    })

    const payingWorkspaces = planMix
      .filter((plan) => plan.isPaid)
      .reduce((total, plan) => total + plan.count, 0)

    return {
      registered: figure(registeredByMonth),
      startedPaying: figure(startedPayingByMonth),
      renewals: figure(renewalsByMonth),
      churned: figure(churnedByMonth),

      months,
      registeredInWindow,
      busiestMonth,
      monthlyAverage: monthsBack === 0 ? 0 : registeredInWindow / monthsBack,

      planMix,
      payingWorkspaces,
      payingPercent:
        organizations.length === 0 ? 0 : (payingWorkspaces / organizations.length) * 100,
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
