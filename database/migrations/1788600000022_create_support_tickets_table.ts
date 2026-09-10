import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Support conversations between one workspace and staff (plan §21).
 *
 * Tenant-owned like every other table here: `organization_id` is on the row
 * and on every query. Who *inside* the workspace may read it is narrower than
 * that — the author and owners (§21.4) — and that rule lives in
 * `SupportService`, not in this schema.
 *
 * Three statuses and no `closed`. `open` means waiting on us, `answered`
 * means waiting on them, `resolved` means done — and a reply to a resolved
 * ticket reopens it, because that is what people do instead of opening a
 * second ticket about the same thing (§21.2).
 */
export default class extends BaseSchema {
  protected tableName = 'support_tickets'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()

      table
        .integer('organization_id')
        .notNullable()
        .references('id')
        .inTable('organizations')
        .onDelete('CASCADE')
        .index()

      /**
       * Who opened it. Nullable so removing a member does not delete the
       * conversation — the ticket belongs to the organisation, the same rule
       * files follow.
       */
      table.integer('created_by_user_id').nullable().index()

      table.string('subject').notNullable()
      table.string('status', 16).notNullable().defaultTo('open')

      /**
       * Denormalised so the list sorts and pages without touching the
       * messages table. Written in the same transaction as the message.
       */
      table.timestamp('last_message_at', { useTz: true }).notNullable()

      /**
       * The one reporting-shaped column here, and the only support number
       * anybody ever asks for: how long until somebody answered. Stamped
       * once, never moved.
       */
      table.timestamp('first_responded_at', { useTz: true }).nullable()

      /**
       * "I am dealing with this one." Not a queue, not a routing rule — see
       * §21.11 for what is deliberately absent.
       */
      table.integer('assigned_staff_id').nullable().index()
      table.timestamp('resolved_at', { useTz: true }).nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      /**
       * The tenant list: this workspace's tickets, newest activity first.
       */
      table.index(['organization_id', 'last_message_at'])

      /**
       * The back-office queue: everything still waiting on us, oldest first.
       */
      table.index(['status', 'last_message_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
