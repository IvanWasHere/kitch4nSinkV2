import type { DateTime } from 'luxon'

/**
 * The payment abstraction (plan §7.1).
 *
 * Everything the application knows about billing is expressed here. Adding
 * Stripe later is one new class in `app/billing/providers/` plus a config
 * entry — **nothing outside that directory may import a provider SDK or
 * speak a provider's wire format**, which is the rule that keeps the swap
 * from turning into a rewrite.
 */
export interface PaymentProvider {
  readonly name: string

  createCheckoutSession(input: CheckoutInput): Promise<{ url: string; sessionId: string }>
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>

  getSubscription(id: string): Promise<ProviderSubscription | null>
  changePlan(input: { subscriptionId: string; productId: string }): Promise<ProviderSubscription>
  cancelSubscription(input: {
    subscriptionId: string
    atPeriodEnd: boolean
  }): Promise<ProviderSubscription>
  resumeSubscription(id: string): Promise<ProviderSubscription>

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean
  parseWebhook(rawBody: Buffer): NormalizedEvent
}

export interface CheckoutInput {
  productId: string
  customerEmail: string
  successUrl: string

  /**
   * Carried through the provider and handed back on the webhook. This is the
   * **only** thread tying a subscription to a tenant (plan §7.5): without
   * `organizationPublicId` in here, a `checkout.completed` cannot be
   * attributed to anyone.
   */
  metadata: { organizationPublicId: string; planKey: string }
}

/**
 * A subscription as the provider describes it, normalised onto our vocabulary
 * so no caller ever reads a provider's own status string.
 */
export interface ProviderSubscription {
  id: string
  customerId: string | null

  /**
   * The provider's product id. Turning it back into one of our plan keys is
   * `PlanService`'s job — the provider layer does not know what a plan is.
   */
  productId: string | null

  status: SubscriptionStatus
  currentPeriodStart: DateTime | null
  currentPeriodEnd: DateTime | null
  cancelAtPeriodEnd: boolean
  trialEndsAt: DateTime | null
  canceledAt: DateTime | null
}

export interface ProviderPayment {
  orderId: string
  subscriptionId: string | null
  customerId: string | null
  amountCents: number
  currency: string
  refundedAmountCents: number
  description: string | null
  receiptUrl: string | null
  occurredAt: DateTime
}

export type SubscriptionStatus =
  'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired'

/**
 * The nine events the application understands (plan §7.2).
 *
 * Creem sends thirteen; several mean the same thing to us, and collapsing
 * them here rather than in the handler is what stops a `subscription.unpaid`
 * branch drifting away from the `subscription.past_due` one.
 */
export type NormalizedEventType =
  | 'subscription.activated'
  | 'subscription.updated'
  | 'subscription.trialing'
  | 'subscription.past_due'
  | 'subscription.paused'
  | 'subscription.canceled'
  | 'payment.succeeded'
  | 'payment.refunded'
  | 'dispute.created'

export interface NormalizedEvent {
  /**
   * The provider's event id — the idempotency key the ledger is unique on.
   */
  providerEventId: string
  type: NormalizedEventType
  occurredAt: DateTime

  /**
   * Recovered from the checkout metadata. Absent on events for a subscription
   * we already know, where the local row supplies the tenant instead.
   */
  organizationPublicId?: string

  subscription?: ProviderSubscription
  payment?: ProviderPayment
  raw: unknown
}

/**
 * A webhook body that arrived with a bad or missing signature, or that cannot
 * be parsed into a normalized event.
 *
 * Separated from a transport failure on purpose: this one is never retried,
 * because no amount of waiting will make the payload valid.
 */
export class WebhookVerificationError extends Error {}

/**
 * The provider answered, and said no. `retryable` is what the queue reads to
 * decide whether trying again could ever help.
 */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean = status >= 500 || status === 429
  ) {
    super(message)
  }
}
