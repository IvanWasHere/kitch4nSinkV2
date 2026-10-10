import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Requests staff start on somebody's behalf (plan §22.8) — a data request
 * that arrived by email or ticket rather than through the person's own
 * Privacy screen.
 */
export default class extends BaseSchema {
  protected tableName = 'privacy_requests'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      /**
       * Who started it. Null for everything the person asked for themselves.
       * A staff-started export is for staff to download; a self-service one
       * is only ever handed to the person.
       */
      table.integer('requested_by_staff_id').nullable()

      /**
       * Why staff started it — the ticket or email the request came in on.
       * Required for a staff-started deletion, which no-one else confirms.
       */
      table.string('staff_note', 500).nullable()
    })
  }

  /**
   * Skipped when the table is already gone — see `…028`.
   */
  async down() {
    if (!(await this.schema.hasTable(this.tableName))) {
      return
    }

    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('requested_by_staff_id')
      table.dropColumn('staff_note')
    })
  }
}
