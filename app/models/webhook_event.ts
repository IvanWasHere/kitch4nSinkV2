import { WebhookEventSchema } from '#database/schema'

/**
 * The idempotency ledger (plan §7.5).
 *
 * The row is written *before* the work is dispatched, and its unique
 * `provider_event_id` is the whole retry defence: a redelivery loses the
 * insert race, the endpoint answers 200, and nothing is applied a second
 * time.
 *
 * Rows are kept after processing so `billing:replay` can re-run a stored
 * payload against the handler with no network.
 */
export default class WebhookEvent extends WebhookEventSchema {
  get isProcessed() {
    return Boolean(this.processedAt)
  }

  get hasFailed() {
    return !this.processedAt && Boolean(this.lastError)
  }
}
