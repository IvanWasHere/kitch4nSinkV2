import type { HttpContext } from '@adonisjs/core/http'

import WebhookEvent from '#models/webhook_event'
import Organization from '#models/organization'
import webhooks, { markProcessed } from '#billing/webhook_handler'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import { paymentProvider } from '#billing/provider'

/**
 * The webhook ledger (plan §12).
 *
 * The reason every payload is stored (plan §7.5): when a customer's
 * entitlements and their invoice disagree, the answer is in here — what the
 * provider sent, whether it was signed, whether we applied it, and what went
 * wrong if we did not.
 */
export default class AdminWebhookController {
  async index({ view, request, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    /**
     * Unprocessed first by default. This screen is opened because something
     * did not happen, so the events that never applied are the ones worth
     * putting at the top.
     */
    const filter = String(request.input('filter', 'unprocessed'))

    const query = WebhookEvent.query().orderBy('id', 'desc').limit(100)

    if (filter === 'unprocessed') {
      query.whereNull('processed_at')
    } else if (filter === 'failed') {
      query.whereNull('processed_at').whereNotNull('last_error')
    }

    return view.render('pages/admin/webhooks/index', {
      events: await query,
      filter,
    })
  }

  async show({ params, view, response, session, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const event = await WebhookEvent.find(params.id)

    if (!event) {
      session.flash('error', 'No such webhook event.')
      return response.redirect().toRoute('admin.webhooks.index')
    }

    /**
     * The tenant it turned out to belong to, resolved the same way the
     * handler resolves it — so the screen shows what the handler saw rather
     * than a second guess at it.
     */
    const organizationPublicId = (event.payload as Record<string, any>)?.object?.metadata
      ?.organization_public_id

    const organization = organizationPublicId
      ? await Organization.query().where('public_id', organizationPublicId).first()
      : null

    return view.render('pages/admin/webhooks/show', {
      event,
      organization,
      /**
       * Pretty-printed for reading, not for machines. The stored payload is
       * the machine-readable copy.
       */
      payload: JSON.stringify(event.payload, null, 2),
      canReplay: await staffBouncer.with('StaffPolicy').allows('replay'),
    })
  }

  /**
   * Re-apply a stored event.
   *
   * Support-level, because it is idempotent by construction: the handler
   * upserts on the provider's own ids, so the worst case is that nothing
   * changes. It is the same code path `billing:replay` runs and the same one
   * the live delivery took — a replay that took a shortcut would prove
   * nothing.
   */
  async replay(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('replay')

    const event = await WebhookEvent.findOrFail(params.id)

    try {
      const normalized = paymentProvider().parseWebhook(Buffer.from(JSON.stringify(event.payload)))

      await webhooks.apply(normalized)
      await markProcessed(event)

      await audit.recordStaffAction(ctx, {
        action: AUDIT_ACTIONS.webhookReplayed,
        subjectType: 'WebhookEvent',
        subjectId: event.providerEventId,
        metadata: { eventType: event.eventType },
      })

      session.flash('success', `${event.eventType} applied.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      /**
       * The failure is recorded on the row, so the next person to open this
       * screen sees why it did not work rather than only that it did not.
       */
      event.lastError = message.slice(0, 2000)
      await event.save()

      session.flash('error', `Still failing: ${message}`)
    }

    return response.redirect().back()
  }
}
