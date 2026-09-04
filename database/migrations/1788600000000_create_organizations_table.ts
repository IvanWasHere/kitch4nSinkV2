import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Organisations are the tenant boundary. Every tenant-owned table carries an
 * `organization_id` and is indexed on it (plan §5.2).
 *
 * `owner_id` is a plain nullable integer with an index rather than a foreign
 * key: organisations and users reference each other, and SQLite cannot add a
 * foreign key to an existing table, so the relationship is enforced in the
 * model (plan §5.3).
 */
export default class extends BaseSchema {
  protected tableName = 'organizations'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()
      table.string('name').notNullable()
      table.string('slug').notNullable().unique()
      table.integer('owner_id').nullable().index()

      table.string('plan_key', 32).notNullable().defaultTo('free')
      table.string('status', 32).notNullable().defaultTo('active')
      table.timestamp('trial_ends_at', { useTz: true }).nullable()

      table.bigint('storage_used_bytes').notNullable().defaultTo(0)

      /**
       * Staff-granted limit raises, merged over the plan's limits (plan §7.4).
       */
      table.json('limit_overrides').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
