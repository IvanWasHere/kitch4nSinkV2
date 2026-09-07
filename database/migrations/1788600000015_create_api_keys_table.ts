import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Organisation API keys (D4, plan §5.2, §11).
 *
 * The key itself is **never stored**. We keep `prefix` — the first characters,
 * so a customer can tell two keys apart in the UI — and `key_hash`, a SHA-256
 * of the whole thing. A leaked backup of this table therefore grants nothing.
 *
 * No salt and no bcrypt, deliberately: a key is 32 characters of random
 * alphabet, not a human-chosen password, so there is nothing for a rainbow
 * table to find and a slow hash would put ~100ms on every API request.
 */
export default class extends BaseSchema {
  protected tableName = 'api_keys'

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

      table.string('name').notNullable()

      /**
       * Shown in the UI so a customer can recognise a key they are about to
       * revoke. Long enough to be distinctive, far too short to be usable.
       */
      table.string('prefix', 16).notNullable()

      /**
       * The lookup column on every authenticated request, so it is indexed
       * and unique — two keys hashing the same would be a collision worth
       * failing loudly on.
       */
      table.string('key_hash', 64).notNullable().unique()

      /**
       * What the key may do (plan §11). A key is not a user, so permissions
       * are explicit rather than inherited from whoever created it.
       */
      table.json('scopes').notNullable()

      table.timestamp('last_used_at', { useTz: true }).nullable()
      table.timestamp('expires_at', { useTz: true }).nullable()
      table.timestamp('revoked_at', { useTz: true }).nullable()

      table.integer('created_by_user_id').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
