import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The idempotency ledger (plan §5.2, §7.5).
 *
 * Creem retries a webhook five times, and a retry is indistinguishable from
 * the first delivery. The unique constraint on `provider_event_id` is what
 * makes that harmless: the second insert fails, the endpoint answers 200, and
 * nothing is applied twice.
 *
 * The raw payload is kept so `billing:replay` can re-run a stored event
 * against the handler with no network at all — the difference between
 * debugging a billing bug in an afternoon and waiting for it to happen again.
 */
export default class extends BaseSchema {
  protected tableName = 'webhook_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      table.string('provider', 32).notNullable()
      table.string('provider_event_id').notNullable().unique()
      table.string('event_type', 64).notNullable()

      table.json('payload').nullable()
      table.boolean('signature_verified').notNullable().defaultTo(false)

      table.timestamp('received_at', { useTz: true }).notNullable()
      table.timestamp('processed_at', { useTz: true }).nullable()
      table.integer('attempts').notNullable().defaultTo(0)
      table.string('last_error', 2000).nullable()

      table.index(['provider', 'received_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
