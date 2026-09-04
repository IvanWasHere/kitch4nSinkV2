import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Due dates are stored UTC and rendered in the organisation's timezone
 * (plan §5.6), which needs somewhere to keep it. Adding a column is not the
 * column *alter* portability rule 4 forbids — SQLite supports adding one.
 */
export default class extends BaseSchema {
  protected tableName = 'organizations'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('timezone', 64).notNullable().defaultTo('UTC')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('timezone')
    })
  }
}
