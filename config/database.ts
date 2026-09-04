import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

/**
 * The application runs on SQLite locally (zero setup) and PostgreSQL when
 * deployed. Both connections are always defined; `DB_CONNECTION` picks one.
 *
 * Application code must never branch on the active dialect — portability is
 * enforced at the migration layer instead. See CONTRIBUTING.md.
 */
const dbConfig = defineConfig({
  connection: env.get('DB_CONNECTION'),

  /**
   * Pretty-print SQL debug output in development logs.
   */
  prettyPrintDebugQueries: true,

  connections: {
    /**
     * SQLite connection — local development and the test suite.
     */
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        filename: env.get('DB_SQLITE_PATH', app.tmpPath('db.sqlite3')),
      },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      debug: app.inDev,
    },

    /**
     * PostgreSQL connection — deployed environments.
     */
    postgres: {
      client: 'pg',
      connection: env.get('DATABASE_URL')
        ? {
            connectionString: env.get('DATABASE_URL')!,
            ssl: env.get('DB_SSL') ? { rejectUnauthorized: false } : false,
          }
        : {
            host: env.get('DB_HOST'),
            port: env.get('DB_PORT'),
            user: env.get('DB_USER'),
            password: env.get('DB_PASSWORD'),
            database: env.get('DB_DATABASE'),
            ssl: env.get('DB_SSL') ? { rejectUnauthorized: false } : false,
          },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      debug: app.inDev,
    },
  },
})

export default dbConfig
