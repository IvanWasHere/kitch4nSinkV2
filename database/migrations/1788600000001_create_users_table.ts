import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Tenant users. Staff live in their own table entirely (D5), so a staff row
 * can never turn up in an organisation-scoped query.
 *
 * One organisation per user (D1): `organization_id` is on the row rather than
 * in a pivot. `role` uses the `owner|member` vocabulary a future
 * `memberships.role` would use, so the day a pivot arrives the values move
 * across unchanged.
 *
 * `password` is nullable — an account created through Google or GitHub has
 * none until the user sets one.
 */
export default class extends BaseSchema {
  protected tableName = 'users'

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
      table.string('role', 16).notNullable().defaultTo('member')

      /**
       * Stored lowercased by the model, with a plain unique index — `citext`
       * does not exist on SQLite (plan §5.1).
       */
      table.string('email', 254).notNullable().unique()
      table.string('password').nullable()
      table.string('full_name').nullable()
      table.string('avatar_key').nullable()

      table.timestamp('email_verified_at', { useTz: true }).nullable()

      /**
       * Encrypted at the model layer; the database only ever sees ciphertext.
       */
      table.text('two_factor_secret').nullable()
      table.text('two_factor_recovery_codes').nullable()
      table.timestamp('two_factor_confirmed_at', { useTz: true }).nullable()

      table.timestamp('last_login_at', { useTz: true }).nullable()
      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
