import type { HttpContext } from '@adonisjs/core/http'

import Subscription from '#models/subscription'
import Organization from '#models/organization'
import plans from '#billing/plan_service'
import reconciliation from '#billing/reconciliation'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import { paymentProvider } from '#billing/provider'
import { PaymentProviderError } from '#billing/contracts'

/**
 * Subscriptions in the back-office (plan §12).
 *
 * Everything here is a mirror of what the provider believes. The two actions
 * are therefore "ask them again" and "tell them to stop" — never "edit our
 * copy", because a local edit that the provider does not know about is how
 * the two silently disagree for a billing cycle.
 */
export default class AdminSubscriptionController {
  async index({ view, request, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const status = String(request.input('status', ''))

    const query = Subscription.query().preload('organization').orderBy('id', 'desc').limit(100)

    if (status) {
      query.where('status', status)
    }

    const [subscriptions, canManage] = await Promise.all([
      query,
      staffBouncer.with('StaffPolicy').allows('manageSubscription'),
    ])

    return view.render('pages/admin/subscriptions/index', {
      subscriptions,
      status,
      canManage,
      statuses: ['trialing', 'active', 'past_due', 'paused', 'canceled', 'expired'],
    })
  }

  /**
   * Re-fetch one subscription from the provider and apply what it says.
   *
   * Support-level: it can only make our copy agree with the provider's, which
   * is the direction that is always safe. This is the button for "the
   * customer paid and nothing happened" — a webhook that never arrived.
   */
  async sync(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('replay')

    const subscription = await Subscription.findOrFail(params.id)
    const organization = await Organization.findOrFail(subscription.organizationId)

    let theirs
    try {
      theirs = await paymentProvider().getSubscription(subscription.providerSubscriptionId)
    } catch (error) {
      session.flash(
        'error',
        error instanceof PaymentProviderError
          ? `The provider could not be reached: ${error.message}`
          : 'The provider could not be reached.'
      )

      return response.redirect().back()
    }

    if (!theirs) {
      session.flash(
        'error',
        'The provider has no record of that subscription. Do not delete ours — that is the evidence.'
      )

      return response.redirect().back()
    }

    const from = subscription.status

    subscription.status = theirs.status
    subscription.currentPeriodStart = theirs.currentPeriodStart
    subscription.currentPeriodEnd = theirs.currentPeriodEnd
    subscription.cancelAtPeriodEnd = theirs.cancelAtPeriodEnd
    subscription.canceledAt = theirs.canceledAt

    const theirPlan = plans.planKeyForProductId(theirs.productId)

    if (theirPlan) {
      subscription.planKey = theirPlan
    }

    await subscription.save()

    /**
     * The entitlement follows the status, the same way the webhook handler
     * derives it — so a sync fixes what the customer can actually do, not
     * just what the admin screen shows.
     */
    if (subscription.isEntitling) {
      await plans.applyPlan(organization, plans.planKeyFor(subscription))
      organization.status = subscription.status === 'past_due' ? 'past_due' : 'active'
    } else {
      await plans.applyPlan(organization, 'free')
      organization.status = 'active'
    }

    await organization.save()

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.subscriptionSynced,
      organization,
      subjectType: 'Subscription',
      subjectId: subscription.providerSubscriptionId,
      metadata: { from, to: subscription.status, planKey: subscription.planKey },
    })

    session.flash('success', `Synced: ${from} → ${subscription.status}.`)
    return response.redirect().back()
  }

  /**
   * Cancel at the provider.
   *
   * Admin only (plan §6) — it ends a paying relationship. It cancels **at
   * the provider** and lets the resulting webhook change our copy, rather
   * than writing `canceled` here and hoping: the provider is what stops
   * charging the card, and our row agreeing without that would leave a
   * customer billed for a plan the admin panel says they cancelled.
   */
  async cancel(ctx: HttpContext) {
    const { params, request, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('manageSubscription')

    const subscription = await Subscription.findOrFail(params.id)
    const organization = await Organization.findOrFail(subscription.organizationId)

    const reason = String(request.input('reason', '')).slice(0, 500)

    if (!reason) {
      session.flash('error', 'Say why. A cancellation with no reason is unanswerable later.')
      return response.redirect().back()
    }

    /**
     * At period end by default: the customer paid for this month, and taking
     * it away early is a refund conversation nobody had.
     */
    const immediately = request.input('immediately') === '1'

    try {
      await paymentProvider().cancelSubscription({
        subscriptionId: subscription.providerSubscriptionId,
        atPeriodEnd: !immediately,
      })
    } catch (error) {
      session.flash(
        'error',
        error instanceof PaymentProviderError
          ? `The provider refused: ${error.message}`
          : 'The provider could not be reached. Nothing was cancelled.'
      )

      return response.redirect().back()
    }

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.subscriptionCanceled,
      organization,
      subjectType: 'Subscription',
      subjectId: subscription.providerSubscriptionId,
      metadata: { reason, immediately },
    })

    session.flash(
      'success',
      immediately
        ? 'Cancelled at the provider, effective now. The webhook will update our copy.'
        : 'Cancelled at the provider, effective at the end of the period. The webhook will update our copy.'
    )

    return response.redirect().back()
  }

  /**
   * Run the whole reconciliation sweep and show what it found.
   *
   * The same code `billing:sync` and the nightly job run, so an operator sees
   * exactly what cron would have.
   */
  async reconcile(ctx: HttpContext) {
    const { view, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('replay')

    const report = await reconciliation.diff()

    return view.render('pages/admin/subscriptions/reconciliation', { report })
  }
}
