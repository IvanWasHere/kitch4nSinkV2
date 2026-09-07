import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The audit trail (plan §5.2, §12).
 *
 * Answers "who did this, and when" for the actions where the answer matters:
 * staff overriding a plan, a support agent impersonating a customer, an owner
 * transferring their workspace away.
 *
 * `actor_type` + `actor_id` rather than a foreign key, because an actor is a
 * tenant user, a staff member, an API key or the system itself — four tables,
 * which no dialect can express as one constraint. Nothing cascades: the whole
 * point of a trail is that it outlives the row that made it.
 *
 * Append-only by convention. Nothing in the application updates or deletes a
 * row here; `PruneAuditLogsJob` is the single exception and it only drops
 * entries past the retention window.
 */
export default class extends BaseSchema {
  protected tableName = 'audit_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()

      /**
       * Nullable: staff and system actions are not scoped to a tenant. When
       * it is set, it is the organisation the action *affected*, which is
       * what makes "show me everything that happened to this customer" a
       * single indexed query.
       */
      table.integer('organization_id').nullable()

      table.string('actor_type', 16).notNullable()
      table.integer('actor_id').nullable()

      /**
       * A dotted, stable verb — `subscription.plan_overridden`. Treated like
       * an API error code: screens and filters branch on it, so renaming one
       * orphans the history it describes.
       */
      table.string('action', 64).notNullable()

      table.string('subject_type', 64).nullable()
      table.string('subject_id', 64).nullable()

      table.json('metadata').nullable()

      table.string('ip', 64).nullable()
      table.string('user_agent', 512).nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()

      table.index(['organization_id', 'created_at'])
      table.index(['actor_type', 'actor_id'])
      table.index(['action'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
