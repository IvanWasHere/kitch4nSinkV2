import router from '@adonisjs/core/services/router'

import env from '#start/env'
import Payment from '#models/payment'
import type User from '#models/user'
import Subscription from '#models/subscription'
import type Organization from '#models/organization'
import plans from '#billing/plan_service'
import { paymentProvider } from '#billing/provider'
import { planFor, type PlanKey } from '#config/plans'

export class BillingError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_purchasable' | 'not_configured' | 'no_subscription' | 'no_customer'
  ) {
    super(message)
  }
}

/**
 * Everything the billing screen does, minus the provider's wire format
 * (plan §7.5).
 *
 * The controller is thin on purpose: checkout and the portal are the two
 * places where a mistake charges a real card, so the decisions — which plan
 * is purchasable, which URL Creem sends the customer back to, what metadata
 * ties the webhook to a tenant — live here where they can be tested without
 * an HTTP request.
 */
export class BillingService {
  /**
   * Start a checkout and return where to send the customer.
   *
   * `metadata.organizationPublicId` is the thread that ties the eventual
   * webhook back to this tenant (plan §7.5). Everything else about the
   * checkout can be reconstructed; this cannot.
   */
  async startCheckout(
    organization: Organization,
    actor: User,
    planKey: PlanKey
  ): Promise<{ url: string }> {
    const plan = planFor(planKey)

    if (plan.priceCents === 0) {
      /**
       * Free is not something you buy. Downgrading is a cancellation through
       * the portal, so that the provider — not us — decides when the paid
       * period actually ends.
       */
      throw new BillingError('The Free plan is not something you check out.', 'not_purchasable')
    }

    if (!plan.creemProductId) {
      throw new BillingError(
        `${plan.name} has no product id configured. Set CREEM_PRODUCT_${planKey.toUpperCase()}.`,
        'not_configured'
      )
    }

    const { url } = await paymentProvider().createCheckoutSession({
      productId: plan.creemProductId,
      customerEmail: actor.email,
      successUrl: `${env.get('APP_URL')}${router.makeUrl('billing.return')}`,
      metadata: { organizationPublicId: organization.publicId, planKey },
    })

    return { url }
  }

  /**
   * Send the owner to the provider's own portal to change a card, download an
   * invoice or cancel.
   *
   * We deliberately do not rebuild any of that: card details never touch this
   * application, and a cancellation decided by the provider comes back as a
   * webhook like every other state change.
   */
  async startPortal(organization: Organization): Promise<{ url: string }> {
    const subscription = await this.activeSubscription(organization)

    if (!subscription) {
      throw new BillingError('This workspace has no subscription to manage.', 'no_subscription')
    }

    if (!subscription.providerCustomerId) {
      /**
       * A subscription recorded before the provider told us who the customer
       * was — rare, and recoverable by re-fetching rather than by showing the
       * owner a dead button.
       */
      const theirs = await paymentProvider().getSubscription(subscription.providerSubscriptionId)

      if (!theirs?.customerId) {
        throw new BillingError(
          'We do not have a billing profile for this workspace yet. Try again in a moment.',
          'no_customer'
        )
      }

      subscription.providerCustomerId = theirs.customerId
      await subscription.save()
    }

    return paymentProvider().createPortalSession({
      customerId: subscription.providerCustomerId!,
      returnUrl: `${env.get('APP_URL')}${router.makeUrl('billing.index')}`,
    })
  }

  /**
   * The subscription the billing screen talks about.
   *
   * Newest first, because a resubscribe leaves the cancelled row behind and
   * the customer means the one they are on now.
   */
  async activeSubscription(organization: Organization): Promise<Subscription | null> {
    return Subscription.query()
      .where('organization_id', organization.id)
      .orderBy('id', 'desc')
      .first()
  }

  /**
   * Transaction history (plan §13.5). Capped rather than paginated: a
   * monthly subscription takes years to fill this, and the provider's portal
   * is the complete record.
   */
  async payments(organization: Organization, limit = 24): Promise<Payment[]> {
    return Payment.query()
      .where('organization_id', organization.id)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
  }

  /**
   * What the billing screen renders: the current plan, the grid, usage, and
   * the history.
   */
  async overview(organization: Organization) {
    const [subscription, payments, usage] = await Promise.all([
      this.activeSubscription(organization),
      this.payments(organization),
      plans.usage(organization),
    ])

    return {
      subscription,
      payments,
      usage,
      plans: plans.purchasablePlans(),
    }
  }
}

export default new BillingService()
