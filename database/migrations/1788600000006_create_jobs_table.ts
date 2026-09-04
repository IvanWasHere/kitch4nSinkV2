import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The job queue (D2, plan §9).
 *
 * A table rather than Redis: the same code runs on SQLite and Postgres, jobs
 * survive a restart, they are inspectable from the admin panel, and running
 * the application locally needs no extra process to install.
 *
 * The index covers exactly the reservation query — the only query that runs
 * on every poll of every worker.
 */
export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('queue', 64).notNullable().defaultTo('default')
      table.string('name', 128).notNullable()
      table.json('payload').nullable()

      table.integer('attempts').notNullable().defaultTo(0)
      table.integer('max_attempts').notNullable().defaultTo(5)

      /**
       * When the job becomes eligible to run. Backoff is expressed by pushing
       * this into the future rather than by sleeping a worker.
       */
      table.timestamp('available_at', { useTz: true }).notNullable()

      /**
       * Held by a worker. A reservation older than the visibility timeout is
       * reclaimed, which is how a job survives the worker that crashed
       * mid-flight.
       */
      table.timestamp('reserved_at', { useTz: true }).nullable()
      table.string('reserved_by', 64).nullable()

      table.timestamp('failed_at', { useTz: true }).nullable()
      table.text('last_error').nullable()

      table.timestamp('created_at', { useTz: true }).notNullable()
      table.timestamp('updated_at', { useTz: true }).nullable()

      table.index(['queue', 'available_at', 'reserved_at'])
      table.index(['failed_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
