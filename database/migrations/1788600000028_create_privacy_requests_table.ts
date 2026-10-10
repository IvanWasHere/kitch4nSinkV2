import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Data export and deletion requests (plan §22.8) — owned by the Privacy
 * module. Here rather than in the module because Lucid records a migration
 * by its path (docs/modules.md).
 *
 * Kept after a request completes: it is the record that the request was
 * made and honoured, which is the one thing about a deleted person this
 * application deliberately remembers.
 */
export default class extends BaseSchema {
  protected tableName = 'privacy_requests'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()

      table.integer('user_id').notNullable()
      table.string('type', 16).notNullable()
      table.string('status', 16).notNullable()

      table.timestamp('requested_at', { useTz: true }).notNullable()
      table.timestamp('confirmed_at', { useTz: true }).nullable()
      table.timestamp('approved_at', { useTz: true }).nullable()
      table.timestamp('started_at', { useTz: true }).nullable()
      table.timestamp('completed_at', { useTz: true }).nullable()

      /**
       * Sanitised: an operator-readable reason, never a stack trace or
       * anything copied out of the user's data.
       */
      table.string('failure_reason', 500).nullable()
      table.string('rejection_reason', 500).nullable()

      /**
       * Where the archive is on the private disk, and when it stops being
       * downloadable. Cleared when the object is purged.
       */
      table.string('export_key').nullable()
      table.bigInteger('export_size_bytes').nullable()
      table.timestamp('export_expires_at', { useTz: true }).nullable()
      table.timestamp('downloaded_at', { useTz: true }).nullable()

      table.integer('processed_by_staff_id').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.index(['user_id', 'type', 'status'])
      table.index(['status', 'export_expires_at'])
    })
  }

  /**
   * `IfExists`, because removing the Privacy module drops this table with a
   * later migration (docs/privacy.md) — and rolling back past that point must
   * not fail on a table that is already gone.
   */
  async down() {
    this.schema.dropTableIfExists(this.tableName)
  }
}
