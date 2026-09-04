/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
| Every third-party credential is declared with `Env.schema.secret()` so it
| can never be accidentally logged or serialised.
|
| Variables belonging to a milestone that is not built yet are declared as
| optional. They are listed here — rather than added later — so `.env.example`
| stays the single description of what the application can be configured with.
|
*/

import { Env } from '@adonisjs/core/env'

/**
 * Postgres credentials are only required when Postgres is the active
 * connection, and only when a `DATABASE_URL` was not supplied.
 */
const usingDiscretePostgres = process.env.DB_CONNECTION === 'postgres' && !process.env.DATABASE_URL

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),
  APP_NAME: Env.schema.string.optional(),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  /*
  |--------------------------------------------------------------------------
  | Database
  |--------------------------------------------------------------------------
  |
  | SQLite locally and in tests, Postgres when deployed. Postgres accepts
  | either a single `DATABASE_URL` or the discrete DB_* variables.
  |
  */
  DB_CONNECTION: Env.schema.enum(['sqlite', 'postgres'] as const),
  DB_SQLITE_PATH: Env.schema.string.optional(),
  DATABASE_URL: Env.schema.string.optional(),
  DB_HOST: Env.schema.string.optionalWhen(!usingDiscretePostgres, { format: 'host' }),
  DB_PORT: Env.schema.number.optionalWhen(!usingDiscretePostgres),
  DB_USER: Env.schema.string.optionalWhen(!usingDiscretePostgres),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string.optionalWhen(!usingDiscretePostgres),
  DB_SSL: Env.schema.boolean.optional(),

  /*
  |--------------------------------------------------------------------------
  | Mail (Resend) — §8, wired up in M3
  |--------------------------------------------------------------------------
  */
  MAIL_MAILER: Env.schema.enum.optional(['smtp', 'resend'] as const),
  MAIL_FROM_ADDRESS: Env.schema.string.optional({ format: 'email' }),
  MAIL_FROM_NAME: Env.schema.string.optional(),
  RESEND_API_KEY: Env.schema.secret.optional(),
  RESEND_BASE_URL: Env.schema.string.optional({ format: 'url' }),
  SMTP_HOST: Env.schema.string.optional({ format: 'host' }),
  SMTP_PORT: Env.schema.number.optional(),

  /*
  |--------------------------------------------------------------------------
  | Payments (Creem) — §7, wired up in M4
  |--------------------------------------------------------------------------
  */
  PAYMENT_PROVIDER: Env.schema.enum.optional(['creem'] as const),
  CREEM_API_KEY: Env.schema.secret.optional(),
  CREEM_API_URL: Env.schema.string.optional({ format: 'url' }),
  CREEM_WEBHOOK_SECRET: Env.schema.secret.optional(),
  CREEM_PRODUCT_PRO: Env.schema.string.optional(),
  CREEM_PRODUCT_BUSINESS: Env.schema.string.optional(),

  /*
  |--------------------------------------------------------------------------
  | Storage (Cloudflare R2) — §10, wired up in M5
  |--------------------------------------------------------------------------
  */
  DRIVE_DISK: Env.schema.enum.optional(['fs', 'r2'] as const),
  R2_ACCOUNT_ID: Env.schema.string.optional(),
  R2_ACCESS_KEY_ID: Env.schema.string.optional(),
  R2_SECRET_ACCESS_KEY: Env.schema.secret.optional(),
  R2_BUCKET: Env.schema.string.optional(),
  R2_ENDPOINT: Env.schema.string.optional({ format: 'url' }),
  R2_PUBLIC_URL: Env.schema.string.optional({ format: 'url' }),

  /*
  |--------------------------------------------------------------------------
  | OAuth (Ally) — wired up in M1
  |--------------------------------------------------------------------------
  */
  GOOGLE_CLIENT_ID: Env.schema.string.optional(),
  GOOGLE_CLIENT_SECRET: Env.schema.secret.optional(),
  GITHUB_CLIENT_ID: Env.schema.string.optional(),
  GITHUB_CLIENT_SECRET: Env.schema.secret.optional(),

  /*
  |--------------------------------------------------------------------------
  | Queue — §9, wired up in M3
  |--------------------------------------------------------------------------
  */
  QUEUE_WORKER_CONCURRENCY: Env.schema.number.optional(),
  QUEUE_POLL_INTERVAL_MS: Env.schema.number.optional(),

  /*
  |--------------------------------------------------------------------------
  | Development conveniences
  |--------------------------------------------------------------------------
  |
  | A fixed six-digit code accepted in place of a real authenticator code, so
  | the seeded accounts can be signed into without an app. Honoured *only*
  | when NODE_ENV is `development`, and only while this is set — see
  | TwoFactorService. Leave it unset anywhere that is not a laptop.
  |
  */
  DEV_TWO_FACTOR_CODE: Env.schema.string.optional(),
})
