import { args, BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Re-run a stored webhook against the handler (plan §7.6).
 *
 *   node ace billing:replay 42          # one ledger row
 *   node ace billing:replay --failed    # everything that never applied
 *
 * No network and no signature: the payload is already in `webhook_events`,
 * which is the whole point of keeping it. This turns "reproduce the billing
 * bug" from "wait for it to happen again" into a command.
 *
 * Safe to run twice. The handler's writes are upserts keyed on the provider's
 * own ids, so replaying an event that already applied changes nothing.
 */
export default class BillingReplay extends BaseCommand {
  static commandName = 'billing:replay'
  static description = 'Re-apply a stored webhook payload with no network call'

  static options: CommandOptions = {
    startApp: true,
  }

  @args.string({
    description: 'The webhook_events row to replay',
    required: false,
  })
  declare eventId?: string

  @flags.boolean({ description: 'Replay every event that has not been processed', default: false })
  declare failed: boolean

  async run() {
    const { default: WebhookEvent } = await import('#models/webhook_event')
    const { default: webhooks, markProcessed } = await import('#billing/webhook_handler')
    const { paymentProvider } = await import('#billing/provider')

    const events = this.failed
      ? await WebhookEvent.query().whereNull('processed_at').orderBy('id', 'asc')
      : await this.oneEvent(WebhookEvent)

    if (events.length === 0) {
      this.logger.info('nothing to replay')
      return
    }

    const provider = paymentProvider()
    let applied = 0

    for (const event of events) {
      try {
        /**
         * Parsed from the stored payload through the provider, exactly as
         * `ProcessWebhookJob` does — a replay that took a shortcut would
         * prove nothing about the live path.
         */
        const normalized = provider.parseWebhook(Buffer.from(JSON.stringify(event.payload)))

        await webhooks.apply(normalized)
        await markProcessed(event)

        applied++
        this.logger.success(`#${event.id} ${event.eventType} applied`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        event.lastError = message.slice(0, 2000)
        await event.save()

        this.logger.error(`#${event.id} ${event.eventType} failed: ${message}`)
        this.exitCode = 1
      }
    }

    this.logger.info(`replayed ${applied} of ${events.length}`)
  }

  private async oneEvent(model: typeof import('#models/webhook_event').default) {
    if (!this.eventId) {
      this.logger.error('Pass a webhook_events id, or --failed to replay everything unprocessed.')
      this.exitCode = 1
      return []
    }

    const event = await model.find(Number(this.eventId))

    if (!event) {
      this.logger.error(`No webhook event #${this.eventId}`)
      this.exitCode = 1
      return []
    }

    return [event]
  }
}
