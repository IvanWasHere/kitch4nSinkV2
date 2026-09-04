import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Todos.
 *
 * `organization_id` is deliberately denormalised from the list (plan §5.2):
 * the tenancy rule — every query against a tenant-owned table filters on
 * `organization_id` — then holds for todos without a join, so a forgotten
 * join can never leak another organisation's rows.
 *
 * The composite foreign key `(todo_list_id, organization_id)` is what stops
 * the denormalised copy from ever disagreeing with the list it belongs to.
 * Plan §5.2 proposed a Postgres-only CHECK plus a model hook on SQLite; a
 * composite key does the same job on both engines, so there is no
 * dialect-specific behaviour to keep in step. The model hook stays, to turn
 * the constraint violation into a readable error.
 */
export default class extends BaseSchema {
  protected tableName = 'todos'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()

      table.integer('organization_id').notNullable()
      table.integer('todo_list_id').notNullable()

      table
        .integer('created_by_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      /**
       * Nulled when the assignee leaves rather than cascading: removing
       * someone must not delete the team's work (plan §5.6).
       */
      table
        .integer('assigned_to_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.string('title', 200).notNullable()
      table.text('notes').nullable()
      table.string('priority', 16).notNullable().defaultTo('normal')

      /**
       * Stored UTC, rendered in the organisation's timezone (plan §5.6).
       */
      table.timestamp('due_at', { useTz: true }).nullable()

      /**
       * Completion is a timestamp, not a boolean, which gives "completed this
       * week" for free. Un-ticking nulls both columns together.
       */
      table.timestamp('completed_at', { useTz: true }).nullable()
      table
        .integer('completed_by_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.integer('position').notNullable().defaultTo(0)

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      table.index(['todo_list_id', 'position'])
      table.index(['organization_id'])
      table.index(['assigned_to_user_id'])
      table.index(['due_at'])

      table
        .foreign(['todo_list_id', 'organization_id'])
        .references(['id', 'organization_id'])
        .inTable('todo_lists')
        .onDelete('CASCADE')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
