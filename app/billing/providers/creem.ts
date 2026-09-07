import { createHmac, timingSafeEqual } from 'node:crypto'
import { DateTime } from 'luxon'

import {
  PaymentProviderError,
  WebhookVerificationError,
  type CheckoutInput,
  type NormalizedEvent,
  type NormalizedEventType,
  type PaymentProvider,
  type ProviderPayment,
  type ProviderSubscription,
  type SubscriptionStatus,
} from '#billing/contracts'

export interface CreemProviderConfig {
  apiKey: string
  apiUrl: string
  webhookSecret: string
}

/**
 * Creem's thirteen event types mapped onto our nine (plan §7.2).
 *
 * `checkout.completed` is the odd one: it means the subscription is live
 * *and*, when an order rode along with it, that money moved. It is mapped to
 * `subscription.activated` here and the payment is attached to the same
 * event, so one delivery produces one ledger row and one dispatch.
 */
const EVENT_MAP: Record<string, NormalizedEventType> = {
  'checkout.completed': 'subscription.activated',
  'subscription.active': 'subscription.activated',
  'subscription.paid': 'payment.succeeded',
  'subscription.trialing': 'subscription.trialing',
  'subscription.update': 'subscription.updated',
  'subscription.past_due': 'subscription.past_due',
  'subscription.unpaid': 'subscription.past_due',
  'subscription.paused': 'subscription.paused',
  'subscription.scheduled_cancel': 'subscription.updated',
  'subscription.canceled': 'subscription.canceled',
  'subscription.expired': 'subscription.canceled',
  'refund.created': 'payment.refunded',
  'dispute.created': 'dispute.created',
}

/**
 * Creem's own subscription statuses, onto ours.
 */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  incomplete: 'past_due',
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
  cancelled: 'canceled',
  expired: 'expired',
}

/**
 * The only class in the codebase that knows what Creem's JSON looks like
 * (plan §7.1).
 *
 * There is no SDK dependency: the four calls we make are plain HTTPS, and a
 * vendor SDK would be a second place for a breaking change to arrive. Every
 * request goes through `request()`, so authentication, timeouts and error
 * classification are decided once.
 */
export class CreemProvider implements PaymentProvider {
  readonly name = 'creem'

  constructor(private config: CreemProviderConfig) {}

  async createCheckoutSession(input: CheckoutInput) {
    const body = await this.request<Record<string, any>>('POST', '/v1/checkouts', {
      product_id: input.productId,
      success_url: input.successUrl,
      customer: { email: input.customerEmail },
      /**
       * Comes back verbatim on the webhook. It is how a `checkout.completed`
       * finds its tenant, so a checkout created without it is unattributable
       * — see `CheckoutInput`.
       */
      metadata: {
        organization_public_id: input.metadata.organizationPublicId,
        plan_key: input.metadata.planKey,
      },
    })

    const url = body.checkout_url ?? body.url

    if (typeof url !== 'string') {
      throw new PaymentProviderError('Creem returned a checkout without a URL', 502)
    }

    return { url, sessionId: String(body.id ?? '') }
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }) {
    const body = await this.request<Record<string, any>>('POST', '/v1/customers/billing', {
      customer_id: input.customerId,
      return_url: input.returnUrl,
    })

    const url = body.customer_portal_link ?? body.url

    if (typeof url !== 'string') {
      throw new PaymentProviderError('Creem returned a portal session without a URL', 502)
    }

    return { url }
  }

  async getSubscription(id: string) {
    try {
      const body = await this.request<Record<string, any>>(
        'GET',
        `/v1/subscriptions?subscription_id=${encodeURIComponent(id)}`
      )

      return this.toSubscription(body)
    } catch (error) {
      /**
       * A subscription the provider has never heard of is an answer, not a
       * failure — `billing:sync` reports it as drift rather than retrying.
       */
      if (error instanceof PaymentProviderError && error.status === 404) {
        return null
      }
      throw error
    }
  }

  async changePlan(input: { subscriptionId: string; productId: string }) {
    const body = await this.request<Record<string, any>>(
      'POST',
      `/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}/upgrade`,
      {
        product_id: input.productId,
        /**
         * Charge the difference now and move the customer immediately. The
         * alternative — waiting for the period to end — makes an upgrade a
         * customer just paid for do nothing, which reliably becomes a support
         * ticket.
         */
        update_behavior: 'proration-charge-immediately',
      }
    )

    return this.toSubscription(body)
  }

  async cancelSubscription(input: { subscriptionId: string; atPeriodEnd: boolean }) {
    const body = await this.request<Record<string, any>>(
      'POST',
      `/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}/cancel`,
      { cancel_at_period_end: input.atPeriodEnd }
    )

    return this.toSubscription(body)
  }

  async resumeSubscription(id: string) {
    const body = await this.request<Record<string, any>>(
      'POST',
      `/v1/subscriptions/${encodeURIComponent(id)}/update`,
      { cancel_at_period_end: false }
    )

    return this.toSubscription(body)
  }

  /**
   * HMAC-SHA256 over the **raw** body, compared in constant time.
   *
   * Raw matters: re-serialising the parsed JSON reorders keys and changes
   * whitespace, and the signature is over bytes. That is why the webhook route
   * keeps the raw body (see the controller).
   */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
    const header = headers['creem-signature'] ?? headers['Creem-Signature']
    const signature = Array.isArray(header) ? header[0] : header

    if (!signature || !this.config.webhookSecret) {
      return false
    }

    const expected = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex')

    const given = Buffer.from(signature, 'utf8')
    const mine = Buffer.from(expected, 'utf8')

    /**
     * `timingSafeEqual` throws on a length mismatch rather than returning
     * false, so the lengths are compared first — and a wrong-length signature
     * is a failure either way.
     */
    if (given.length !== mine.length) {
      return false
    }

    return timingSafeEqual(given, mine)
  }

  /**
   * Creem's payload, normalised (plan §7.2).
   *
   * Anything unrecognised throws rather than being silently dropped: an event
   * type we have no mapping for is a change at the provider that somebody has
   * to look at, and the ledger row is what surfaces it.
   */
  parseWebhook(rawBody: Buffer): NormalizedEvent {
    let body: Record<string, any>

    try {
      body = JSON.parse(rawBody.toString('utf8'))
    } catch {
      throw new WebhookVerificationError('Webhook body was not JSON')
    }

    const creemType = String(body.eventType ?? body.event_type ?? body.type ?? '')
    const type = EVENT_MAP[creemType]

    if (!type) {
      throw new WebhookVerificationError(`Unmapped Creem event type "${creemType}"`)
    }

    const providerEventId = String(body.id ?? '')

    if (!providerEventId) {
      throw new WebhookVerificationError('Webhook arrived without an event id')
    }

    const object = body.object ?? {}

    /**
     * `checkout.completed` wraps the subscription and the order one level
     * deeper than the subscription events do.
     */
    const subscriptionObject =
      creemType === 'checkout.completed' ? (object.subscription ?? null) : object
    const orderObject = creemType === 'checkout.completed' ? (object.order ?? null) : object.order

    const metadata = object.metadata ?? subscriptionObject?.metadata ?? {}

    return {
      providerEventId,
      type,
      occurredAt: this.toDateTime(body.created_at) ?? DateTime.utc(),
      organizationPublicId: metadata.organization_public_id ?? undefined,
      subscription: subscriptionObject ? this.toSubscription(subscriptionObject) : undefined,
      payment: this.toPayment(creemType, object, orderObject),
      raw: body,
    }
  }

  /**
   * A Creem subscription object → `ProviderSubscription`.
   *
   * Creem returns nested objects when it has them and bare id strings when it
   * does not, so every reference is read through `idOf`.
   */
  private toSubscription(body: Record<string, any>): ProviderSubscription {
    return {
      id: String(body.id ?? ''),
      customerId: this.idOf(body.customer),
      productId: this.idOf(body.product),
      status: STATUS_MAP[String(body.status ?? '')] ?? 'active',
      currentPeriodStart: this.toDateTime(
        body.current_period_start_date ?? body.current_period_start
      ),
      currentPeriodEnd: this.toDateTime(body.current_period_end_date ?? body.current_period_end),
      cancelAtPeriodEnd: Boolean(
        body.cancel_at_period_end ?? (body.canceled_at ? body.status !== 'canceled' : false)
      ),
      trialEndsAt: this.toDateTime(body.trial_end_date ?? body.trial_end),
      canceledAt: this.toDateTime(body.canceled_at),
    }
  }

  /**
   * The order an event is about, when it is about one.
   *
   * Only events that actually concern a charge produce this. A
   * `subscription.update` carrying a stale order object must not write a
   * second charge into the ledger, which is why the list is explicit rather
   * than "whenever an order is present".
   *
   * `dispute.created` is in the list even though it moves no money: it points
   * at a charge that already exists, and the handler reads nothing from it
   * but `orderId`.
   */
  private toPayment(
    creemType: string,
    object: Record<string, any>,
    order: Record<string, any> | null
  ): ProviderPayment | undefined {
    const concernsAnOrder = [
      'checkout.completed',
      'subscription.paid',
      'refund.created',
      'dispute.created',
    ].includes(creemType)

    if (!concernsAnOrder) {
      return undefined
    }

    const isRefund = creemType === 'refund.created'
    const source = isRefund ? object : (order ?? object)
    const orderId = this.idOf(isRefund ? (object.order ?? source) : source)

    if (!orderId) {
      return undefined
    }

    return {
      orderId,
      subscriptionId: this.idOf(source.subscription ?? object.subscription),
      customerId: this.idOf(source.customer ?? object.customer),
      /**
       * Already minor units on the wire, and kept that way all the way to the
       * column (portability rule 8).
       */
      amountCents: Number(source.amount ?? source.amount_paid ?? 0),
      currency: String(source.currency ?? 'USD').toUpperCase(),
      refundedAmountCents: isRefund
        ? Number(object.refund_amount ?? object.amount ?? 0)
        : Number(source.amount_refunded ?? 0),
      description: source.description ?? null,
      receiptUrl: source.receipt_url ?? source.invoice_url ?? null,
      occurredAt: this.toDateTime(source.created_at) ?? DateTime.utc(),
    }
  }

  /**
   * Creem sends either a nested object or a bare id for the same field
   * depending on the endpoint. One reader for both.
   */
  private idOf(value: unknown): string | null {
    if (typeof value === 'string') {
      return value || null
    }

    if (value && typeof value === 'object' && 'id' in value) {
      const id = (value as { id: unknown }).id
      return typeof id === 'string' ? id : null
    }

    return null
  }

  /**
   * Timestamps arrive as ISO strings or as epoch seconds, and always land as
   * UTC — the application stores nothing else (portability rule 3).
   */
  private toDateTime(value: unknown): DateTime | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    const parsed =
      typeof value === 'number'
        ? DateTime.fromSeconds(value, { zone: 'utc' })
        : DateTime.fromISO(String(value), { zone: 'utc' })

    return parsed.isValid ? parsed.toUTC() : null
  }

  /**
   * Every call to Creem. One place for the key, the timeout and the decision
   * about whether a failure is worth retrying.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.config.apiKey) {
      throw new PaymentProviderError('CREEM_API_KEY is not configured', 500, false)
    }

    let response: Response

    try {
      response = await fetch(`${this.config.apiUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'x-api-key': this.config.apiKey,
          'content-type': 'application/json',
          'accept': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        /**
         * A checkout redirect that hangs is worse than one that fails: the
         * customer is sitting on a spinner with their card out.
         */
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      /**
       * A connection that never completed is always worth retrying — the
       * request may not have been received at all.
       */
      throw new PaymentProviderError(
        `Could not reach Creem: ${error instanceof Error ? error.message : String(error)}`,
        503,
        true
      )
    }

    const text = await response.text()

    if (!response.ok) {
      throw new PaymentProviderError(
        `Creem ${method} ${path} failed with ${response.status}: ${text.slice(0, 500)}`,
        response.status
      )
    }

    return (text ? JSON.parse(text) : {}) as T
  }
}
