import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The demo domain (D8): shared to-do lists.
 *
 * Lists belong to the **organisation**, not to whoever made one — every
 * member sees every list (plan §5.6). `created_by_user_id` is provenance for
 * the UI and must never be used as an access check.
 *
 * Plan §5.2 asks for `unique(organization_id, name)` among non-deleted rows.
 * Partial indexes do not exist on SQLite (portability rule 5), so the index
 * here is plain and non-unique and the rule is enforced inside the create and
 * rename transactions. A plain unique index would permanently block reusing
 * the name of a list somebody deleted.
 */
export default class extends BaseSchema {
  protected tableName = 'todo_lists'

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

      /**
       * Kept as a tombstone when the author leaves: deleting a user must not
       * delete shared work (plan §5.6).
       */
      table
        .integer('created_by_user_id')
        .nullable()
        .references('id')
        .inTable('users')
        .onDelete('SET NULL')

      table.string('name', 120).notNullable()
      table.string('description', 500).nullable()

      /**
       * A design-token name, never a hex — the palette lives in
       * resources/css/tokens.css and this has to survive a rebrand.
       */
      table.string('color', 16).notNullable().defaultTo('blue')

      /**
       * Sparse manual ordering (100, 200, 300…) so inserting between two rows
       * is a single write. NormalizePositionsJob rebalances when the gaps run
       * out.
       */
      table.integer('position').notNullable().defaultTo(0)

      /**
       * Denormalised because the per-list cap is checked on every todo create
       * (plan §5.5). Only ever mutated inside the same transaction as the
       * todo insert or delete.
       */
      table.integer('todos_count').notNullable().defaultTo(0)

      /**
       * Archiving hides a list and is reversible. Archived lists still count
       * against the `lists` quota, so archiving cannot dodge the cap.
       */
      table.timestamp('archived_at', { useTz: true }).nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      table.index(['organization_id', 'position'])
      table.index(['organization_id', 'name'])

      /**
       * Not for lookups: it is the target of the composite foreign key on
       * `todos`, which is what makes a todo's denormalised organisation id
       * impossible to disagree with its list's.
       */
      table.unique(['id', 'organization_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
