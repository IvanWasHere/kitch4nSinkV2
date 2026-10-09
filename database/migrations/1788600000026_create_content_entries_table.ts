import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Posts and pages (plan §22.6) — owned by the Content module.
 *
 * One table for both: they share every column but `excerpt`, and differ only
 * in where they are listed. Here rather than in the module because Lucid
 * records a migration by its path (docs/modules.md).
 *
 * Not tenant-owned. Content is the product's public site, written by staff.
 */
export default class extends BaseSchema {
  protected tableName = 'content_entries'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('public_id', 32).notNullable().unique()

      table.string('type', 8).notNullable()
      table.string('title', 200).notNullable()

      /**
       * Unique across posts *and* pages, so `/about` and `/posts/about` can
       * never be two different things, and an old slug can redirect without
       * asking which kind it was.
       */
      table.string('slug', 120).notNullable().unique()

      table.text('excerpt').nullable()

      /**
       * Markdown source. Rendered on every read, never stored as HTML — a
       * renderer fix then reaches every post at once.
       */
      table.text('body').notNullable()

      table.string('status', 16).notNullable()

      /**
       * Set the first time an entry is published and never moved after,
       * including by unpublishing. A future value is a scheduled post.
       */
      table.timestamp('published_at', { useTz: true }).nullable()

      table.integer('created_by_staff_id').nullable()
      table.integer('updated_by_staff_id').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      /**
       * The public listing: published posts, newest first.
       */
      table.index(['type', 'status', 'published_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
