/*
|--------------------------------------------------------------------------
| Development toolbar
|--------------------------------------------------------------------------
|
| Whether `adonisjs-server-stats` — the live stats bar, the debug panel and
| the `/__stats` dashboard — is wired into this process.
|
*/

/**
 * Whether a module can be resolved from here.
 *
 * `import.meta.resolve` throws for a package that is not installed, which is
 * exactly the question being asked, and it answers it without evaluating the
 * module.
 */
function isInstalled(specifier: string): boolean {
  try {
    import.meta.resolve(specifier)

    return true
  } catch {
    return false
  }
}

/**
 * The toolbar is a **devDependency**, and the runtime image is built with
 * `npm ci --omit=dev` (Dockerfile): deployed, the package is not on disk at
 * all. Every place that registers it — the provider in `adonisrc.ts`, the
 * middleware in `#start/kernel`, the config in `#config/server_stats`, the
 * tag in the layout — therefore has to be guarded on this flag, or the
 * process dies on an unresolvable import before it answers a request.
 *
 * Two conditions, because each one alone has a hole:
 *
 *   - `NODE_ENV` is read from `process.env` rather than `#start/env`, and
 *     compared against `'production'` rather than `'development'`. That is
 *     not a stylistic choice: `adonisrc.ts` imports this file, and AdonisJS
 *     evaluates the RC file *before* it loads `.env`, so at that moment
 *     `NODE_ENV` is `undefined` on a developer's machine even though `.env`
 *     sets it to `development`. The obvious spelling — `=== 'development'`
 *     — silently disables the toolbar for everyone, and leaves no trace
 *     saying why. The Dockerfile sets `NODE_ENV=production` as a real
 *     process variable, so the negative test is the one that works in both
 *     directions.
 *
 *   - The resolve check covers what the first one misses: a deployment that
 *     runs the compiled build without `NODE_ENV` in the process environment.
 *     There the flag above says "on" and the package is still absent, and
 *     this is what keeps that from being a crash loop.
 *
 * `test` is excluded separately, and not as an optimisation. The suite
 * installs dev dependencies, so the package is present and the production
 * test alone would say "on" — but the provider is registered for the `web`
 * environment only, and the test runner boots the application as `test`. The
 * provider would therefore *not* load while everything keyed on this flag
 * still behaved as though it had: `layouts/base.edge` would include a
 * partial holding a `@serverStats()` tag that nothing had registered, and
 * Edge writes an unknown tag into the page as literal text. Every functional
 * and browser assertion against rendered HTML would be comparing against a
 * page with `@serverStats()` printed at the bottom of it. Keeping the flag
 * off in `test` also leaves `#config/shield` on its nonce policy there,
 * which is the one production uses.
 *
 * The value is computed once per process and the three environments each
 * read it consistently: the test runner sets `NODE_ENV=test` before the
 * application process starts, so unlike the local case above there is no
 * window in which this is evaluated too early to see it.
 */
export const serverStatsEnabled =
  process.env.NODE_ENV !== 'production' &&
  process.env.NODE_ENV !== 'test' &&
  isInstalled('adonisjs-server-stats')
