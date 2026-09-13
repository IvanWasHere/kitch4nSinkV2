import { serverStatsEnabled } from '#start/dev_toolbar'

/**
 * The development toolbar — `adonisjs-server-stats`.
 *
 * A live stats bar at the foot of every page (CPU, memory, event-loop lag,
 * request throughput, database pool), a debug panel over it with the SQL
 * this request ran, the events it emitted and the mail it sent, and a
 * dashboard at `/__stats` with the history of all of it.
 *
 * The package is a devDependency and the runtime image is built without dev
 * dependencies, so the import is behind the flag rather than at the top of
 * the file: config files are loaded eagerly at boot, and an unconditional
 * `import` here would be a missing-module crash in production even though
 * nothing deployed ever reads the result. `{}` is the value the loader gets
 * there — nothing registers it, because the provider is absent too.
 *
 * The collector list is spelled out rather than left on `'auto'`. See the
 * note on `collectors` below for the one reason why.
 */
const serverStats = serverStatsEnabled ? await import('adonisjs-server-stats') : null

const collectors = serverStats ? await import('adonisjs-server-stats/collectors') : null

const serverStatsConfig =
  serverStats && collectors
    ? serverStats.defineConfig({
        /**
         * `'auto'` would be this exact list plus `appCollector()`, and that one
         * has to go.
         *
         * It counts rows in `sessions`, `webhook_events` and `scheduled_emails`
         * on every tick — three tables this application happens to have, so it
         * works, and three `SELECT COUNT(*)` every three seconds forever. Both
         * connections in `#config/database` run with `debug: app.inDev` and
         * `prettyPrintDebugQueries`, so each of those lands in the terminal —
         * sixty lines a minute, on an idle server, between you and anything
         * you were actually trying to read. A dev tool that makes the dev log
         * unreadable is a net loss.
         *
         * What it costs is three tiles — online users, pending webhooks,
         * pending emails. Everything else, including the per-request Queries
         * panel, is unaffected; those come from `db:query` events, not from
         * this collector.
         *
         * The other way out is turning off `prettyPrintDebugQueries` and
         * reading SQL in the debug panel instead of the terminal. That is a
         * bigger change to how this project is developed than adding a toolbar
         * has any business making, so it is left alone.
         *
         * The cost of being explicit: a collector added to the package, or a
         * dependency added here that would have been detected (Redis, BullMQ),
         * now has to be added to this list by hand.
         */
        collectors: [
          collectors.processCollector(),
          collectors.systemCollector(),
          collectors.httpCollector(),
          collectors.logCollector(),
          collectors.dbPoolCollector(),
        ],

        /**
         * No guard, and the routes are open to anyone who can reach the port.
         *
         * This is the setting the package calls unsafe, and it means it: the
         * debug panel renders resolved environment variables, the bodies of
         * sent mail, and every SQL statement with its bindings. It is
         * tolerable here for exactly one reason — the two lines above mean
         * these routes do not exist in any deployed environment, and cannot,
         * because the code implementing them was never installed there.
         *
         * The flag is ignored in production by the package regardless. What
         * makes it safe is the absence, not the flag.
         *
         * If this ever needs to run somewhere reachable by anyone else, delete
         * this line and gate it on the back-office session instead:
         *
         *   authorize: async (ctx) => ctx.auth.use('staff').check(),
         */
        unsafeAllowNoAuth: true,

        /**
         * The debug panel, and with it per-request tracing. `db:query` events
         * are already emitted locally — both connections in
         * `#config/database` set `debug: app.inDev` — so the Queries tab is
         * populated without further configuration.
         */
        toolbar: true,

        /**
         * The `/__stats` page. Its history lives in a SQLite file under
         * `.adonisjs/server-stats/`, which is git-ignored; `.adonisjs` itself
         * is not, because the codegen under it is committed.
         */
        dashboard: true,
      })
    : {}

export default serverStatsConfig
