import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A workspace logo, mirroring `users.avatar_key` (plan §17, M5).
 *
 * A **key**, not a URL, for the same reason every other stored object is
 * (plan §10). Its own migration because adding a column is additive and safe
 * on both engines; changing one would not be (portability rule 4).
 */
export default class extends BaseSchema {
  protected tableName = 'organizations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('logo_key', 1024).nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('logo_key')
    })
  }
}
