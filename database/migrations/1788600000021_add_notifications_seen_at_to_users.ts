import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The whole of the unread mechanism, in one column (plan §20.4).
 *
 * The dot is "does anything that applies to me have `published_at` later than
 * this?". No `notification_reads` table, no row per user per announcement —
 * and reading this value *before* stamping it also gives "new since your last
 * visit" highlighting for free.
 *
 * Its own migration because adding a column is additive and safe on both
 * engines; changing one would not be (portability rule 4).
 */
export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.timestamp('notifications_seen_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('notifications_seen_at')
    })
  }
}
