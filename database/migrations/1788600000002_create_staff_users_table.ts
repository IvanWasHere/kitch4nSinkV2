import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Company staff (D5). Physically separate from `users` so there is no
 * role-escalation path on the tenant table and no way for a staff row to leak
 * into an organisation-scoped query. Two-factor is mandatory for staff, which
 * is enforced by middleware rather than by a column.
 */
export default class extends BaseSchema {
  protected tableName = 'staff_users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()
      table.string('email', 254).notNullable().unique()
      table.string('password').notNullable()
      table.string('full_name').nullable()
      table.string('role', 16).notNullable().defaultTo('support')

      table.text('two_factor_secret').nullable()
      table.text('two_factor_recovery_codes').nullable()
      table.timestamp('two_factor_confirmed_at', { useTz: true }).nullable()

      table.timestamp('last_login_at', { useTz: true }).nullable()
      table.timestamp('disabled_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
