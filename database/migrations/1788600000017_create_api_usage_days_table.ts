import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Nightly rollup of `api_requests` (plan §5.2).
 *
 * Raw request rows are pruned after 30 days; these survive, so a customer's
 * usage chart does not silently lose its history and support can still answer
 * "how much were they calling us in March?".
 *
 * `day` is a plain `YYYY-MM-DD` string rather than a date column: it is only
 * ever grouped and compared for equality, and a string means the two engines
 * cannot disagree about what a date is (portability rule 3 exists precisely
 * because they do).
 */
export default class extends BaseSchema {
  protected tableName = 'api_usage_days'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      table
        .integer('organization_id')
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      table.string('day', 10).notNullable()
      table.integer('requests').notNullable().defaultTo(0)

      /**
       * Split out because "we made 40,000 calls" and "9,000 of them failed"
       * are different conversations.
       */
      table.integer('errors').notNullable().defaultTo(0)

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      /**
       * One row per organisation per day, which is what makes the rollup
       * idempotent: a second run updates rather than doubling.
       */
      table.unique(['organization_id', 'day'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
