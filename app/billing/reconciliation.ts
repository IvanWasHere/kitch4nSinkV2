import logger from '@adonisjs/core/services/logger'

import plans from '#billing/plan_service'
import Subscription from '#models/subscription'
import Organization from '#models/organization'
import { paymentProvider } from '#billing/provider'
import { PaymentProviderError } from '#billing/contracts'

export interface DriftEntry {
  subscriptionId: number
  providerSubscriptionId: string
  organizationId: number
  field: string
  ours: string | null
  theirs: string | null
}

export interface ReconciliationReport {
  checked: number
  drifted: DriftEntry[]
  missing: DriftEntry[]
  corrected: number
}

/**
 * Diffs local subscriptions against the provider (plan §7.5).
 *
 * A webhook that is lost — a bad deploy, an endpoint that 500s past Creem's
 * five retries — leaves a customer on the wrong plan silently and forever.
 * This is the sweep that finds that, and it is deliberately a *report*: the
 * only thing it corrects is a status mismatch, because that is the one whose
 * cost is immediate in both directions.
 */
export class ReconciliationService {
  /**
   * Look, report, change nothing. What `billing:sync --dry-run` runs, and the
   * half of `reconcile()` that decides.
   */
  async diff(): Promise<ReconciliationReport> {
    const { report } = await this.scan()
    return report
  }

  /**
   * Look, report, and correct the one thing worth correcting.
   */
  async reconcile(): Promise<ReconciliationReport> {
    const { report, corrections } = await this.scan()

    for (const correction of corrections) {
      await this.correctStatus(correction.subscription, correction.status)
      report.corrected++
    }

    return report
  }

  /**
   * The read-only pass.
   *
   * Correcting is deliberately not done inline: a scan that writes as it goes
   * cannot be reused for a dry run without a "don't write" boolean threaded
   * through it, and that boolean is how a dry run eventually writes
   * something.
   */
  private async scan(): Promise<{
    report: ReconciliationReport
    corrections: { subscription: Subscription; status: Subscription['status'] }[]
  }> {
    const provider = paymentProvider()

    /**
     * Cancelled and expired subscriptions are skipped: they are terminal, the
     * provider will not change them, and a workspace that cancelled two years
     * ago should not cost a network call every night.
     */
    const subscriptions = await Subscription.query().whereNotIn('status', ['canceled', 'expired'])

    const report: ReconciliationReport = { checked: 0, drifted: [], missing: [], corrected: 0 }
    const corrections: { subscription: Subscription; status: Subscription['status'] }[] = []

    for (const subscription of subscriptions) {
      report.checked++

      let theirs
      try {
        theirs = await provider.getSubscription(subscription.providerSubscriptionId)
      } catch (error) {
        /**
         * A provider having a bad minute is not drift. Logged and skipped, so
         * one unreachable call does not become a page of false alarms.
         */
        logger.warn(
          { err: error, subscriptionId: subscription.id },
          'could not fetch a subscription while reconciling'
        )

        if (error instanceof PaymentProviderError && !error.retryable) {
          throw error
        }

        continue
      }

      const base = {
        subscriptionId: subscription.id,
        providerSubscriptionId: subscription.providerSubscriptionId,
        organizationId: subscription.organizationId,
      }

      if (!theirs) {
        report.missing.push({
          ...base,
          field: 'existence',
          ours: subscription.status,
          theirs: null,
        })
        continue
      }

      if (theirs.status !== subscription.status) {
        report.drifted.push({
          ...base,
          field: 'status',
          ours: subscription.status,
          theirs: theirs.status,
        })

        corrections.push({ subscription, status: theirs.status })
      }

      const theirPlan = plans.planKeyForProductId(theirs.productId)

      if (theirPlan && theirPlan !== subscription.planKey) {
        report.drifted.push({
          ...base,
          field: 'planKey',
          ours: subscription.planKey,
          theirs: theirPlan,
        })
      }

      /**
       * Compared as instants, not as strings. A timestamp read back from the
       * database carries a zone offset (`…+00:00`) while one parsed from the
       * provider's payload carries `Z`, so comparing `toISO()` would report
       * drift on every subscription, every night, for ever. Only the *report*
       * renders them as strings.
       */
      const oursEnd = subscription.currentPeriodEnd ?? null
      const theirsEnd = theirs.currentPeriodEnd ?? null

      if (oursEnd?.toMillis() !== theirsEnd?.toMillis()) {
        report.drifted.push({
          ...base,
          field: 'currentPeriodEnd',
          ours: oursEnd?.toUTC().toISO() ?? null,
          theirs: theirsEnd?.toUTC().toISO() ?? null,
        })
      }
    }

    return { report, corrections }
  }

  /**
   * Bring the status — and the entitlement that follows from it — back in
   * line with the provider.
   *
   * Only the status. Period dates and plan keys are reported and left alone,
   * because correcting those silently would paper over the missing webhook
   * that caused them.
   */
  private async correctStatus(
    subscription: Subscription,
    status: Subscription['status']
  ): Promise<void> {
    subscription.status = status
    await subscription.save()

    const organization = await Organization.find(subscription.organizationId)

    if (!organization) {
      return
    }

    if (subscription.isEntitling) {
      await plans.applyPlan(organization, plans.planKeyFor(subscription))
      organization.status = status === 'past_due' ? 'past_due' : 'active'
    } else {
      await plans.applyPlan(organization, 'free')
      organization.status = 'active'
    }

    await organization.save()
  }
}

export default new ReconciliationService()
