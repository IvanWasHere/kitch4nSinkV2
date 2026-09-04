import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Pending invitations to join an organisation.
 *
 * Plan §5.2 asks for `unique(organization_id, email) where not accepted`.
 * Partial indexes do not exist on SQLite (portability rule 5), so the index
 * here is plain and non-unique, and "one live invitation per address per
 * organisation" is enforced inside the invite transaction instead. The
 * alternative — a plain unique index — would permanently block re-inviting
 * someone whose invitation was revoked or who later left.
 *
 * Only the sha256 hash of the token is stored, exactly as for auth_tokens:
 * the invitation link is a credential that grants access to a workspace.
 */
export default class extends BaseSchema {
  protected tableName = 'invitations'

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

      table.string('email', 254).notNullable()
      table.string('role', 16).notNullable().defaultTo('member')
      table.string('token_hash', 64).notNullable().index()

      table
        .integer('invited_by_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.timestamp('expires_at', { useTz: true }).notNullable()
      table.timestamp('accepted_at', { useTz: true }).nullable()
      table.timestamp('revoked_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.index(['organization_id', 'email'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
