import logger from '@adonisjs/core/services/logger'

import WebhookEvent from '#models/webhook_event'
import webhooks, { markProcessed } from '#billing/webhook_handler'
import { paymentProvider } from '#billing/provider'
import { UnrecoverableJobError, type JobContext, type JobHandler } from '#queue/contracts'

export interface ProcessWebhookPayload {
  /**
   * The ledger row, not the payload. The event body is already stored and is
   * re-read here, so a webhook is never carried twice — once in
   * `webhook_events.payload` and once in `jobs.payload` — where the two
   * copies could disagree.
   */
  webhookEventId: number
}

/**
 * Applies a stored webhook (plan §7.5, steps 3-4).
 *
 * The endpoint's only job is to verify, insert the ledger row and answer 200
 * inside ~50ms; everything that touches the domain happens here, where a
 * failure can retry with backoff instead of making Creem retry for us.
 *
 * Idempotent twice over: the ledger's unique `provider_event_id` stops a
 * redelivery becoming a second job, and every write the handler makes is an
 * upsert keyed on a provider id, so a job retried after doing half its work
 * still finishes correctly.
 */
class ProcessWebhookJob implements JobHandler<ProcessWebhookPayload> {
  readonly name = 'process_webhook'

  async handle(payload: ProcessWebhookPayload, { job, isFinalAttempt }: JobContext) {
    const ledger = await WebhookEvent.find(payload.webhookEventId)

    if (!ledger) {
      /**
       * The row is written before the job is dispatched, so a missing one
       * means the database was rolled back or cleaned underneath us. No
       * amount of retrying will bring it back.
       */
      throw new UnrecoverableJobError(`Webhook event #${payload.webhookEventId} no longer exists`)
    }

    /**
     * Already applied. Returning rather than re-applying is the cheap half of
     * idempotency — the handler's upserts are the half that has to be correct
     * when this check loses a race.
     */
    if (ledger.isProcessed) {
      logger.debug({ webhookEventId: ledger.id }, 'webhook already processed')
      return
    }

    ledger.attempts = job.attempts + 1
    await ledger.save()

    try {
      /**
       * Re-parsed from the stored payload rather than passed through the job,
       * so a replay from the CLI and a live delivery run through exactly the
       * same code path (plan §7.6).
       */
      const event = paymentProvider().parseWebhook(Buffer.from(JSON.stringify(ledger.payload)))

      await webhooks.apply(event)
      await markProcessed(ledger)

      logger.info(
        { webhookEventId: ledger.id, type: ledger.eventType },
        'applied a billing webhook'
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      ledger.lastError = message.slice(0, 2000)
      await ledger.save()

      if (isFinalAttempt) {
        /**
         * Loud, because a webhook that never applies means the customer's
         * entitlements and their invoice disagree. The row stays unprocessed
         * so the admin panel can list it and `billing:replay` can re-run it
         * once the cause is fixed.
         */
        logger.error(
          { err: error, webhookEventId: ledger.id, type: ledger.eventType },
          'a billing webhook could not be applied and has been parked'
        )
      }

      throw error
    }
  }
}

export default new ProcessWebhookJob()
