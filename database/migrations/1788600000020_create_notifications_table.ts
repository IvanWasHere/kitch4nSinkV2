import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Staff-authored announcements (plan §20).
 *
 * **The one table in this schema that is deliberately not tenant-owned.**
 * There is no `organization_id`, because crossing tenants is the feature: one
 * row reaches every workspace on the Pro plan. Which users it reaches is
 * decided by `audience_type` + `audience`, and by nothing else — see
 * `app/notifications/audience.ts`, which is where a bug here would leak one
 * customer's announcement to another.
 *
 * One-way and non-transactional. Nothing in the application emits a row here;
 * a payment receipt is an email (§8) and a quota block is a 402 (§7.4). That
 * is what keeps this table at tens of rows a year, which is the assumption
 * the unread mechanism rests on (§20.4).
 */
export default class extends BaseSchema {
  protected tableName = 'notifications'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()

      table.string('title').notNullable()
      table.text('body').notNullable()

      /**
       * Maps onto the four `.notif-icon-wrap` variants ported in M0, so the
       * feature needs no new icon styling.
       */
      table.string('level', 16).notNullable().defaultTo('info')

      table.string('audience_type', 16).notNullable()

      /**
       * `{ planKeys: [...] }` or `{ userIds: [...] }` depending on the type;
       * null for `all`. JSON rather than two more columns because the shape
       * differs per type and only one is ever populated.
       */
      table.json('audience').nullable()

      /**
       * An optional single call to action. One, not many: an announcement
       * with three buttons is a page, and this is a notification.
       */
      table.string('action_label', 60).nullable()
      table.string('action_url', 1024).nullable()

      /**
       * Null is a draft — it exists in the back-office and reaches nobody.
       */
      table.timestamp('published_at', { useTz: true }).nullable()

      /**
       * Null is forever. Set it and the announcement stops showing, which is
       * what stops last March's maintenance notice being on the screen in
       * June.
       */
      table.timestamp('expires_at', { useTz: true }).nullable()

      table.integer('created_by_staff_id').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      /**
       * The feed's query: published, newest first.
       */
      table.index(['published_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
