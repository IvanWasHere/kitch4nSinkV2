import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * One message in a support conversation (plan §21.2).
 *
 * **Two nullable author columns, not one polymorphic id.** Tenant users and
 * staff live in separate tables behind separate guards (D5); a single
 * `author_id` would need `author_type` read before the row meant anything,
 * and would be a foreign key to nowhere. Exactly one of the two is set, and
 * `SupportService` is the only thing that writes either.
 *
 * No status here. A conversation has one state and it is the ticket's.
 */
export default class extends BaseSchema {
  protected tableName = 'support_messages'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()

      table
        .integer('support_ticket_id')
        .notNullable()
        .references('id')
        .inTable('support_tickets')
        .onDelete('CASCADE')
        .index()

      table.string('author_type', 16).notNullable()
      table.integer('author_user_id').nullable().index()
      table.integer('author_staff_id').nullable().index()

      table.text('body').notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      /**
       * The conversation, oldest first — the only way this table is ever
       * read.
       */
      table.index(['support_ticket_id', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
