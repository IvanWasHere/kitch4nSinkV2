import env from '#start/env'
import { defineConfig, stores } from '@adonisjs/limiter'

/**
 * Rate limiting (plan §11).
 *
 * The **database** store, not Redis. This boilerplate deliberately has one
 * datastore: an API doing tens of requests a second does not justify another
 * piece of infrastructure to deploy, monitor, secure and pay for, and the
 * store dialect-switches internally so it works on SQLite and Postgres alike.
 *
 * The trade-off, stated plainly: every rate-limited request costs a write to
 * `rate_limits`. If this application ever needs thousands of requests a
 * second, `LIMITER_STORE=redis` plus a connection is the whole change.
 *
 * `memory` is for tests, where a shared table would make one test's traffic
 * another's rate limit.
 *
 * **One trap if you change a window.** The memory store expires records with
 * `setTimeout`, so a duration beyond Node's ~24.8-day ceiling (2^31 ms) fires
 * immediately and the counter resets on *every* request — silently, looking
 * exactly like an unlimited plan. The database store has no such limit
 * (expiry is a column), so this only bites in tests, which is the worst place
 * for it to bite. `ApiRateLimitMiddleware` keeps every window well below the
 * ceiling for that reason.
 */
const limiterConfig = defineConfig({
  default: env.get('LIMITER_STORE', 'database'),

  stores: {
    database: stores.database({ tableName: 'rate_limits' }),
    memory: stores.memory({}),
  },
})

export default limiterConfig

declare module '@adonisjs/limiter/types' {
  export interface LimitersList extends InferLimiters<typeof limiterConfig> {}
}
