import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * One row per API request (plan §5.2, §11).
 *
 * Two jobs: usage a customer can see, and a trail support can follow when
 * somebody says "your API returned an error at half past two". The
 * `X-Request-Id` echoed on the response is the column that makes the second
 * one possible.
 *
 * This table grows fastest of anything in the schema, so `RollupApiUsageJob`
 * aggregates it nightly into `api_usage_days` and prunes rows past 30 days.
 * Nothing reads it beyond that window.
 */
export default class extends BaseSchema {
  protected tableName = 'api_requests'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      table
        .integer('organization_id')
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')

      /**
       * Nullable and *not* a foreign key with a cascade: revoking a key must
       * not erase the record of what it did.
       */
      table.integer('api_key_id').nullable()

      table.string('request_id', 64).nullable()
      table.string('method', 8).notNullable()
      table.string('path', 512).notNullable()
      table.integer('status').notNullable()
      table.integer('duration_ms').notNullable()
      table.string('ip', 64).nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()

      /**
       * The rollup's query and the usage screen's: one organisation, one
       * window of time.
       */
      table.index(['organization_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
