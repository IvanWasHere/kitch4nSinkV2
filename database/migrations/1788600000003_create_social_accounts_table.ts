import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * A linked Google or GitHub identity.
 *
 * The unique index on (provider, provider_user_id) is the thing that makes
 * "sign in with Google" idempotent: a second sign-in finds the existing link
 * rather than creating a second account for the same person.
 */
export default class extends BaseSchema {
  protected tableName = 'social_accounts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table
        .integer('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE')
        .index()

      table.string('provider', 32).notNullable()
      table.string('provider_user_id').notNullable()
      table.string('provider_email', 254).nullable()

      /**
       * Encrypted at the model layer. Stored only so a future integration can
       * call the provider on the user's behalf; nothing reads it yet.
       */
      table.text('access_token').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.unique(['provider', 'provider_user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
