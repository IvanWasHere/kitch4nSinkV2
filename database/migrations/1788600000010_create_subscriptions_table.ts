import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * One row per subscription the payment provider knows about (plan §5.2).
 *
 * This table is a **mirror**, not the truth: the provider owns the
 * subscription and every column here is written from a webhook or from a
 * reconciliation fetch. Nothing in the application writes a status directly,
 * which is what keeps "what we think we sold" and "what they are being
 * charged for" from diverging.
 *
 * `organizations.plan_key` is the entitlement the rest of the app reads. It
 * is derived from the active row here, so gating never has to join.
 */
export default class extends BaseSchema {
  protected tableName = 'subscriptions'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('organization_id')
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
        .index()

      table.string('provider', 32).notNullable()
      table.string('provider_subscription_id').notNullable()
      table.string('provider_customer_id').nullable()

      table.string('plan_key', 32).notNullable()
      table.string('status', 32).notNullable()

      table.timestamp('current_period_start', { useTz: true }).nullable()
      table.timestamp('current_period_end', { useTz: true }).nullable()
      table.boolean('cancel_at_period_end').notNullable().defaultTo(false)
      table.timestamp('trial_ends_at', { useTz: true }).nullable()
      table.timestamp('canceled_at', { useTz: true }).nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      /**
       * The provider's id is the identity. A webhook arriving twice — Creem
       * retries five times — must update one row rather than insert a second.
       */
      table.unique(['provider', 'provider_subscription_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
