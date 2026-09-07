import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The rate limiter's store (plan §11).
 *
 * A database store rather than Redis: this boilerplate has one datastore on
 * purpose, and an API doing tens of requests a second does not need another
 * piece of infrastructure to deploy, monitor and pay for. The shape is
 * `@adonisjs/limiter`'s own — `rate-limiter-flexible` reads and writes it
 * directly, and it dialect-switches internally, so this stays inside
 * portability rule 6.
 */
export default class extends BaseSchema {
  protected tableName = 'rate_limits'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('key', 255).notNullable().primary()
      table.integer('points', 9).notNullable().defaultTo(0)
      table.bigint('expire').unsigned()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
