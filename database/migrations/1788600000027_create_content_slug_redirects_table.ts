import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Slugs a published entry used to have (plan §22.6). A request for one is
 * answered with a 301 to wherever the entry lives now, so changing a title
 * does not break every link that was ever shared.
 */
export default class extends BaseSchema {
  protected tableName = 'content_slug_redirects'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('old_slug', 120).notNullable().unique()
      table.integer('content_entry_id').notNullable().index()
      table.timestamp('created_at', { useTz: true }).notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
