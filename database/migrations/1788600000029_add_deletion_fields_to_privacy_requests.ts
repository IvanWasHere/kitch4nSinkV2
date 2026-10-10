import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * What an account deletion needs beyond an export (plan §22.8.2).
 *
 * New nullable columns rather than an edit to the create migration: that one
 * has already run on databases, and editing history is how two installs end
 * up with different schemas (CONTRIBUTING).
 */
export default class extends BaseSchema {
  protected tableName = 'privacy_requests'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      /**
       * For an account with no password (signed up with Google or GitHub),
       * the deletion is confirmed by an emailed link instead. Only the hash
       * is stored.
       */
      table.string('confirmation_token_hash', 64).nullable().index()
      table.timestamp('confirmation_expires_at', { useTz: true }).nullable()

      /**
       * Where to send "your account has been deleted" — captured before the
       * user row's address is overwritten, and cleared the moment that email
       * is queued. The only copy of the address that outlives the overwrite,
       * and only for as long as it takes to say goodbye.
       */
      table.string('notification_email').nullable()
    })
  }

  /**
   * Skipped when the table is already gone — removing the Privacy module
   * drops it with a later migration, and rolling back past that point must
   * not fail here.
   */
  async down() {
    if (!(await this.schema.hasTable(this.tableName))) {
      return
    }

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('confirmation_token_hash')
      table.dropColumn('confirmation_expires_at')
      table.dropColumn('notification_email')
    })
  }
}
