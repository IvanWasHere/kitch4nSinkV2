import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Runtime settings an administrator changes without a deploy (plan §22.3, D11).
 *
 * One row per key, and an absent row means the key's default — so a fresh
 * install has an empty table and behaves exactly as the defaults say. Keys
 * are declared in code (`app/settings/settings_service.ts`), never invented
 * here: a key nobody declared is a value nothing reads.
 *
 * `value` is JSON so a key can hold a boolean, a number or a small object
 * without a column per type (plan §5.1, rule 2).
 */
export default class extends BaseSchema {
  protected tableName = 'site_settings'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('key', 100).notNullable().unique()
      table.json('value').nullable()

      /**
       * Who last changed it, for the settings screen. The full history is the
       * audit log's job (`settings.changed`), not this column's.
       */
      table.integer('updated_by_staff_id').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
