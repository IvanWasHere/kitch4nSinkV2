import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Single-use tokens for email verification and password reset.
 *
 * Only the sha256 hash is stored, so a leaked database row cannot be replayed
 * as a login. `consumed_at` makes a token single-use even if the link is
 * followed twice.
 */
export default class extends BaseSchema {
  protected tableName = 'auth_tokens'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .index()

      table.string('type', 32).notNullable()
      table.string('token_hash', 64).notNullable().index()
      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.timestamp('consumed_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
