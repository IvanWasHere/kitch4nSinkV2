import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'

import queue from '#queue/queue_service'
import WebhookEvent from '#models/webhook_event'
import { paymentProvider } from '#billing/provider'
import { WebhookVerificationError } from '#billing/contracts'
import processWebhookJob from '#queue/jobs/process_webhook_job'

/**
 * The provider's webhook endpoint (plan §7.5).
 *
 * Four steps, in this order, and the order is the whole design:
 *
 * 1. **Verify** the signature over the raw body. Fail → 401 and stop; an
 *    unsigned body is an attacker telling us somebody upgraded.
 * 2. **Insert** the ledger row. A unique violation means we have seen this
 *    event before, which is not an error — Creem retries five times — so the
 *    answer is 200 and nothing else happens.
 * 3. **Dispatch** the work onto the queue and answer 200 inside ~50ms. A
 *    provider that times out waiting for us retries, and a retry storm during
 *    a slow database is how billing state gets applied four times.
 * 4. The worker applies it (`ProcessWebhookJob`), where a failure can back off
 *    and be retried on our terms rather than the provider's.
 *
 * CSRF-exempt — there is no session and no form here; the signature *is* the
 * authentication (see `config/shield.ts`).
 */
export default class WebhookController {
  async creem({ request, response }: HttpContext) {
    /**
     * The **raw** body, not the parsed one. The signature is an HMAC over
     * bytes, and re-serialising parsed JSON reorders keys and drops
     * whitespace, which produces a different digest every time.
     */
    const raw = request.raw()

    if (!raw) {
      return response.status(400).send({ error: 'empty body' })
    }

    const rawBody = Buffer.from(raw, 'utf8')
    const provider = paymentProvider()

    if (!provider.verifyWebhook(rawBody, request.headers())) {
      logger.warn(
        { ip: request.ip(), bytes: rawBody.length },
        'rejected a billing webhook with an invalid signature'
      )

      return response.status(401).send({ error: 'invalid signature' })
    }

    let event
    try {
      event = provider.parseWebhook(rawBody)
    } catch (error) {
      /**
       * A signed body we cannot understand — an event type Creem added, most
       * likely. 200 rather than 400: the delivery was genuine and retrying it
       * will not make us understand it, so the log line is the action item.
       */
      if (error instanceof WebhookVerificationError) {
        logger.warn({ err: error }, 'received a signed webhook we could not parse')
        return response.status(200).send({ received: true, applied: false })
      }

      throw error
    }

    try {
      /**
       * The ledger row and the job that applies it, in one transaction. Split
       * apart, a failure between them leaves an event recorded but never
       * applied — the customer's entitlements and their invoice disagree, and
       * nothing retries, because the provider was already told 200. Rolled
       * back together, the provider's next retry is the recovery.
       */
      await db.transaction(async (trx) => {
        const ledger = await WebhookEvent.create(
          {
            provider: provider.name as 'creem',
            providerEventId: event.providerEventId,
            eventType: event.type,
            payload: event.raw as Record<string, any>,
            signatureVerified: true,
            receivedAt: DateTime.utc(),
            attempts: 0,
          },
          { client: trx }
        )

        await queue.dispatch(processWebhookJob, { webhookEventId: ledger.id }, { client: trx })
      })

      return response.status(200).send({ received: true })
    } catch (error) {
      /**
       * The unique index on `provider_event_id` doing its job. A redelivery
       * loses this insert, and losing it is the correct outcome — the first
       * delivery already queued the work.
       *
       */
      if (this.isDuplicate(error)) {
        logger.debug(
          { providerEventId: event.providerEventId },
          'ignored a redelivered billing webhook'
        )
        return response.status(200).send({ received: true, duplicate: true })
      }

      throw error
    }
  }

  /**
   * Whether an insert failed because the event was already recorded.
   *
   * Matched on the message rather than on an error code, because SQLite and
   * Postgres disagree about the code. Both say "unique" — SQLite as `UNIQUE
   * constraint failed: …`, Postgres as `… violates unique constraint …` — and
   * the match deliberately stops there: a looser test for "constraint" would
   * swallow a foreign-key failure as a duplicate and answer 200 to an event
   * that was never applied.
   */
  private isDuplicate(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : ''

    return message.includes('unique') || message.includes('duplicate key')
  }
}
