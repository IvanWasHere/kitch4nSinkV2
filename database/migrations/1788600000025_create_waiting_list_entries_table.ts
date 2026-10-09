import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The waiting list (plan §22.5) — owned by Registration Control.
 *
 * Here rather than in the module because Lucid records a migration by its
 * path (docs/modules.md); removing the module from an existing install means a
 * new migration that drops this table, never deleting this file.
 *
 * Not tenant-owned: somebody on the waiting list has no organisation yet.
 */
export default class extends BaseSchema {
  protected tableName = 'waiting_list_entries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()

      /**
       * Lowercased at the model layer, so a plain unique index is
       * case-insensitive uniqueness (plan §5.1, rule 5).
       */
      table.string('email').notNullable().unique()

      table.string('status', 24).notNullable()

      /**
       * The double opt-in setting as it was when this person joined. Changing
       * the setting affects future sign-ups only, so each row has to remember
       * which rules it joined under.
       */
      table.boolean('double_opt_in_required').notNullable()

      /**
       * sha256 of the confirmation token. The token itself exists only in the
       * email that was sent.
       */
      table.string('confirmation_token_hash', 64).nullable().index()
      table.timestamp('confirmation_expires_at', { useTz: true }).nullable()

      table.timestamp('confirmed_at', { useTz: true }).nullable()
      table.timestamp('converted_at', { useTz: true }).nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      /**
       * The admin list filters by status, newest first.
       */
      table.index(['status', 'created_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
