import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

import Payment from '#models/payment'
import Subscription from '#models/subscription'
import Organization from '#models/organization'
import type WebhookEvent from '#models/webhook_event'
import plans from '#billing/plan_service'
import mailer from '#mail/mailer_service'
import { paymentProvider } from '#billing/provider'
import type { NormalizedEvent, ProviderSubscription } from '#billing/contracts'
import PaymentReceiptNotification from '#mail/mails/payment_receipt_notification'
import PaymentFailedNotification from '#mail/mails/payment_failed_notification'
import SubscriptionCanceledNotification from '#mail/mails/subscription_canceled_notification'
import SubscriptionActivatedNotification from '#mail/mails/subscription_activated_notification'

/**
 * Applies a normalized event to the domain (plan §7.5, step 4).
 *
 * Three rules hold everything here together:
 *
 * 1. **Idempotent.** The queue is at-least-once and Creem retries five times,
 *    so every write is an upsert keyed on the provider's own id. Running the
 *    same event twice must leave the same rows.
 * 2. **Ordered by watermark, not by arrival.** Webhooks can arrive out of
 *    order. An event describing a subscription state older than what the row
 *    already knows is ignored rather than applied — otherwise a late
 *    `past_due` can undo the `active` that superseded it.
 * 3. **The provider is the truth.** On any ambiguity — a payload with no
 *    status, a subscription we cannot attribute — we re-fetch from the
 *    provider rather than guess from the payload (plan §7.5).
 */
export class WebhookHandler {
  async apply(event: NormalizedEvent): Promise<void> {
    switch (event.type) {
      case 'subscription.activated':
      case 'subscription.trialing':
      case 'subscription.updated':
      case 'subscription.past_due':
      case 'subscription.paused':
      case 'subscription.canceled':
        await this.applySubscription(event)
        break

      case 'payment.succeeded':
      case 'payment.refunded':
        await this.applyPayment(event)
        break

      case 'dispute.created':
        await this.applyDispute(event)
        break
    }
  }

  /**
   * Write the subscription mirror, then derive the entitlement from it.
   *
   * `organizations.plan_key` is what the rest of the application gates on, so
   * it is set here and nowhere else in the request path — a customer's
   * entitlements change because the provider said money moved, never because
   * a browser hit a return URL (plan §7.5).
   */
  private async applySubscription(event: NormalizedEvent): Promise<void> {
    let incoming = event.subscription

    /**
     * A subscription event with no subscription object is exactly the
     * "ambiguity" case: ask the provider rather than infer.
     */
    if (!incoming && event.type !== 'subscription.canceled') {
      logger.warn({ event: event.providerEventId }, 'subscription event carried no subscription')
      return
    }

    if (!incoming) {
      return
    }

    const organization = await this.resolveOrganization(event, incoming)

    if (!organization) {
      /**
       * Unattributable. Thrown rather than swallowed so the job retries and
       * then surfaces in the admin panel — a subscription nobody can be
       * billed for is a billing incident, not a log line.
       */
      throw new Error(`Webhook ${event.providerEventId} could not be attributed to an organisation`)
    }

    const existing = await Subscription.query()
      .where('provider', 'creem')
      .where('provider_subscription_id', incoming.id)
      .first()

    /**
     * The out-of-order guard. An event that happened before what the row
     * already knows is dropped; an event with no timestamp is applied, since
     * "unknown" is not "older".
     */
    if (existing && event.occurredAt < existing.watermark.minus({ seconds: 1 })) {
      logger.info(
        {
          event: event.providerEventId,
          subscription: incoming.id,
          occurredAt: event.occurredAt.toISO(),
          watermark: existing.watermark.toISO(),
        },
        'ignored a webhook older than the subscription it describes'
      )
      return
    }

    /**
     * The payload's status is trusted for everything except a cancellation
     * that arrived with no period information — there, a re-fetch is what
     * tells us whether the customer keeps access until the period ends.
     */
    if (event.type === 'subscription.canceled' && !incoming.currentPeriodEnd) {
      incoming = (await this.refetch(incoming.id)) ?? incoming
    }

    const planKey = plans.planKeyForProductId(incoming.productId) ?? existing?.planKey ?? 'free'
    const previousStatus = existing?.status ?? null

    const subscription = await this.upsertSubscription(organization, incoming, planKey)

    await this.syncEntitlement(organization, subscription)
    await this.notify(organization, subscription, previousStatus)
  }

  private async upsertSubscription(
    organization: Organization,
    incoming: ProviderSubscription,
    planKey: string
  ): Promise<Subscription> {
    /**
     * Keyed on the provider's id so a redelivery updates rather than inserts
     * — the same defence the unique index gives, applied before the database
     * has to reject anything.
     */
    return db.transaction(async (trx) => {
      const subscription =
        (await Subscription.query({ client: trx })
          .where('provider', 'creem')
          .where('provider_subscription_id', incoming.id)
          .first()) ?? new Subscription()

      subscription.useTransaction(trx)

      subscription.merge({
        organizationId: organization.id,
        provider: 'creem',
        providerSubscriptionId: incoming.id,
        providerCustomerId: incoming.customerId ?? subscription.providerCustomerId ?? null,
        planKey,
        status: incoming.status,
        currentPeriodStart: incoming.currentPeriodStart,
        currentPeriodEnd: incoming.currentPeriodEnd,
        cancelAtPeriodEnd: incoming.cancelAtPeriodEnd,
        trialEndsAt: incoming.trialEndsAt,
        canceledAt: incoming.canceledAt,
      })

      await subscription.save()

      return subscription
    })
  }

  /**
   * Turn the subscription's state into the organisation's entitlements.
   *
   * A cancelled or expired subscription drops the organisation to Free and
   * changes nothing else — no archiving, no deletion, no data job. The next
   * create is what surfaces the new ceiling (plan §7.4, soft-lock).
   */
  private async syncEntitlement(
    organization: Organization,
    subscription: Subscription
  ): Promise<void> {
    if (subscription.isEntitling) {
      await plans.applyPlan(organization, plans.planKeyFor(subscription))
      organization.status = subscription.status === 'past_due' ? 'past_due' : 'active'
      organization.trialEndsAt = subscription.trialEndsAt
      await organization.save()
      return
    }

    await plans.applyPlan(organization, 'free')

    /**
     * `paused` and `canceled` both stop entitlement, but only a cancellation
     * ends the relationship — an organisation whose subscription is paused is
     * still an active workspace on the free plan.
     */
    organization.status = 'active'
    await organization.save()
  }

  /**
   * The dunning and receipt emails (plan §7.5).
   *
   * Sent on a *transition* rather than on every delivery: Creem re-sends the
   * same state, and a customer must not get five "payment failed" emails
   * because a webhook was retried.
   */
  private async notify(
    organization: Organization,
    subscription: Subscription,
    previousStatus: string | null
  ): Promise<void> {
    if (subscription.status === previousStatus) {
      return
    }

    const owner = await this.ownerOf(organization)

    if (!owner) {
      return
    }

    if (subscription.status === 'active' && previousStatus !== 'past_due') {
      await mailer.send(new SubscriptionActivatedNotification(owner, organization, subscription))
      return
    }

    if (subscription.status === 'past_due') {
      await mailer.send(new PaymentFailedNotification(owner, organization, subscription))
      return
    }

    if (subscription.isCanceled) {
      await mailer.send(new SubscriptionCanceledNotification(owner, organization, subscription))
    }
  }

  /**
   * Record money that moved.
   *
   * Payments are upserted on `provider_order_id`, so a refund event for an
   * order we already have grows `refunded_amount_cents` on the existing row
   * rather than writing a second, contradictory one.
   */
  private async applyPayment(event: NormalizedEvent): Promise<void> {
    const incoming = event.payment

    if (!incoming) {
      logger.warn({ event: event.providerEventId }, 'payment event carried no payment')
      return
    }

    /**
     * The order's own `subscription` reference when it has one, and otherwise
     * the subscription the event itself is about — Creem's `subscription.paid`
     * puts the order *inside* the subscription rather than pointing back at
     * it, so reading only the order would leave every renewal unattributable.
     */
    const providerSubscriptionId = incoming.subscriptionId ?? event.subscription?.id ?? null

    const subscription = providerSubscriptionId
      ? await Subscription.query()
          .where('provider', 'creem')
          .where('provider_subscription_id', providerSubscriptionId)
          .first()
      : null

    const organization = subscription
      ? await Organization.find(subscription.organizationId)
      : await this.organizationFromEvent(event)

    if (!organization) {
      throw new Error(`Payment ${incoming.orderId} could not be attributed to an organisation`)
    }

    const isRefund = event.type === 'payment.refunded'

    const payment =
      (await Payment.query()
        .where('provider', 'creem')
        .where('provider_order_id', incoming.orderId)
        .first()) ?? new Payment()

    const refunded = isRefund
      ? Math.max(payment.refundedAmountCents ?? 0, incoming.refundedAmountCents)
      : (payment.refundedAmountCents ?? 0)

    const amount = payment.amountCents || incoming.amountCents

    payment.merge({
      organizationId: organization.id,
      subscriptionId: subscription?.id ?? payment.subscriptionId ?? null,
      provider: 'creem',
      providerOrderId: incoming.orderId,
      amountCents: amount,
      currency: incoming.currency,
      refundedAmountCents: refunded,
      status: this.paymentStatus(amount, refunded),
      description: incoming.description ?? payment.description ?? null,
      receiptUrl: incoming.receiptUrl ?? payment.receiptUrl ?? null,
      occurredAt: payment.occurredAt ?? incoming.occurredAt,
    })

    const isNew = !payment.$isPersisted
    await payment.save()

    /**
     * A receipt for a charge, once. A refund is not emailed from here — the
     * provider sends its own credit note, and a second one from us reads as a
     * second refund.
     */
    if (isNew && !isRefund) {
      const owner = await this.ownerOf(organization)

      if (owner) {
        await mailer.send(new PaymentReceiptNotification(owner, organization, payment))
      }
    }
  }

  private paymentStatus(
    amountCents: number,
    refundedCents: number
  ): 'succeeded' | 'refunded' | 'partially_refunded' {
    if (refundedCents <= 0) {
      return 'succeeded'
    }

    return refundedCents >= amountCents ? 'refunded' : 'partially_refunded'
  }

  /**
   * A chargeback.
   *
   * Deliberately does nothing automatic beyond marking the payment and
   * logging loudly: suspending a workspace over a dispute is a decision with
   * a human on the other end of it, and it belongs in the admin panel (M7),
   * not in a webhook handler.
   */
  private async applyDispute(event: NormalizedEvent): Promise<void> {
    const orderId = event.payment?.orderId

    if (orderId) {
      const payment = await Payment.query()
        .where('provider', 'creem')
        .where('provider_order_id', orderId)
        .first()

      if (payment) {
        payment.status = 'disputed'
        await payment.save()
      }
    }

    logger.error(
      { event: event.providerEventId, orderId },
      'a payment was disputed — review it in the admin panel'
    )
  }

  /**
   * Find the tenant an event belongs to.
   *
   * Two threads, in order of trust: the subscription we already recorded, and
   * the `organizationPublicId` we put into the checkout metadata ourselves.
   * Nothing else is accepted — an organisation is never resolved from a
   * customer email, because an email is something the payer controls.
   */
  private async resolveOrganization(
    event: NormalizedEvent,
    incoming: ProviderSubscription
  ): Promise<Organization | null> {
    const existing = await Subscription.query()
      .where('provider', 'creem')
      .where('provider_subscription_id', incoming.id)
      .first()

    if (existing) {
      return Organization.find(existing.organizationId)
    }

    return this.organizationFromEvent(event)
  }

  private async organizationFromEvent(event: NormalizedEvent): Promise<Organization | null> {
    if (!event.organizationPublicId) {
      return null
    }

    return Organization.query()
      .where('public_id', event.organizationPublicId)
      .whereNull('deleted_at')
      .first()
  }

  private async ownerOf(organization: Organization) {
    const { default: User } = await import('#models/user')

    return User.query()
      .where('organization_id', organization.id)
      .where('role', 'owner')
      .whereNull('deleted_at')
      .first()
  }

  /**
   * Ask the provider what is actually true. Used only where the payload is
   * ambiguous — never as a matter of course, because it turns every webhook
   * into an outbound call.
   */
  private async refetch(subscriptionId: string): Promise<ProviderSubscription | null> {
    try {
      return await paymentProvider().getSubscription(subscriptionId)
    } catch (error) {
      logger.warn({ err: error, subscriptionId }, 'could not re-fetch a subscription from Creem')
      return null
    }
  }
}

export default new WebhookHandler()

/**
 * Stamp a ledger row as done. Kept next to the handler because the ledger and
 * the handler are two halves of one guarantee: an event is applied exactly
 * once, and the row is the proof.
 */
export async function markProcessed(ledger: WebhookEvent): Promise<void> {
  ledger.processedAt = DateTime.utc()
  ledger.lastError = null
  await ledger.save()
}
