import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Uploaded files (plan §5.2, §10).
 *
 * The row stores **`disk` + `key`, never a URL**. That single rule is what
 * makes moving from the local filesystem to R2 — or from R2 to anywhere else
 * — a config change rather than a data migration: a URL bakes today's vendor,
 * today's bucket and today's signing scheme into every row.
 *
 * Deletion is soft. `PurgeDeletedFilesJob` removes the object after 30 days,
 * so somebody who deletes the wrong thing has a month to say so.
 */
export default class extends BaseSchema {
  protected tableName = 'files'

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

      /**
       * Who uploaded it. Nullable so removing a member does not take their
       * uploads with them — the file belongs to the organisation.
       */
      table.integer('user_id').nullable().index()

      /**
       * The *purpose* disk (`private` | `public`), not the vendor. What backs
       * each one is decided by `DRIVE_DISK` in `config/drive.ts`.
       */
      table.string('disk', 32).notNullable()
      table.string('key', 1024).notNullable()

      table.string('original_name').notNullable()
      table.string('mime_type', 128).notNullable()
      table.bigint('size_bytes').notNullable()
      table.string('visibility', 16).notNullable().defaultTo('private')

      /**
       * SHA-256 of the bytes. Lets a re-upload be recognised, and lets the
       * purge job prove it is deleting the object it thinks it is.
       */
      table.string('checksum', 64).nullable()

      /**
       * Optional polymorphic owner — an avatar on a user, a logo on an
       * organisation. Deliberately not a foreign key: it points at several
       * tables, and no dialect can express that.
       */
      table.string('attachable_type', 64).nullable()
      table.integer('attachable_id').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()
      table.timestamp('deleted_at', { useTz: true }).nullable()

      /**
       * The purge job's query: soft-deleted, oldest first.
       */
      table.index(['deleted_at'])
      table.index(['attachable_type', 'attachable_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
