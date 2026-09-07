import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The money that actually moved (plan §5.2).
 *
 * Amounts are integer minor units (portability rule 8) — a float here is a
 * rounding bug waiting for the one invoice that matters. A refund does not
 * delete or negate the row: `refunded_amount_cents` grows and the status
 * moves, so the history a customer sees matches the provider's.
 */
export default class extends BaseSchema {
  protected tableName = 'payments'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()

      table
        .integer('organization_id')
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
        .index()

      /**
       * Nullable: a one-off charge has no subscription, and a payment can
       * outlive the subscription row it came from.
       */
      table
        .integer('subscription_id')
        .nullable()
        .references('id')
        .inTable('subscriptions')
        .onDelete('SET NULL')

      table.string('provider', 32).notNullable()
      table.string('provider_order_id').notNullable()

      table.integer('amount_cents').notNullable()
      table.string('currency', 8).notNullable().defaultTo('USD')
      table.string('status', 32).notNullable()
      table.integer('refunded_amount_cents').notNullable().defaultTo(0)

      table.string('description').nullable()
      table.string('receipt_url', 1024).nullable()
      table.timestamp('occurred_at', { useTz: true }).notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.unique(['provider', 'provider_order_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
