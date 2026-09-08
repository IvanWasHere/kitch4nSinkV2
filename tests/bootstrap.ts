import { assert } from '@japa/assert'
import app from '@adonisjs/core/services/app'
import limiter from '@adonisjs/limiter/services/main'
import type { Config } from '@japa/runner/types'
import { apiClient } from '@japa/api-client'
import { browserClient } from '@japa/browser-client'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import { dbAssertions } from '@adonisjs/lucid/plugins/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import { authBrowserClient } from '@adonisjs/auth/plugins/browser_client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'
import { sessionBrowserClient } from '@adonisjs/session/plugins/browser_client'
import { shieldApiClient } from '@adonisjs/shield/plugins/api_client'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  dbAssertions(app),
  apiClient(),
  sessionApiClient(app),
  authApiClient(app),
  shieldApiClient(),
  browserClient({ runInSuites: ['browser'] }),
  sessionBrowserClient(app),
  authBrowserClient(app),
]

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  /**
   * Migrate once for the whole run. On SQLite the test database lives in
   * memory, so this is also the only thing that creates it; on Postgres it
   * rebuilds the schema so the same suite proves the migrations run on both
   * engines (CONTRIBUTING.md).
   */
  setup: [() => testUtils.db().migrate()],
  teardown: [],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    suite.setup(() => testUtils.httpServer().start())

    /**
     * Every test starts from an empty database. Truncating keeps the schema,
     * so it is considerably faster than re-migrating between tests.
     *
     * `truncate()` hands back the cleanup that does the work, so this hook
     * must *return* it rather than await it — swallow the return value and
     * the tables are never emptied, which surfaces later as a unique
     * constraint in whichever test happened to run second.
     */
    suite.onGroup((group) => {
      /**
       * The rate limiter is emptied for the same reason the tables are.
       * Tests share a process and, from the limiter's point of view, share
       * an address: without this the eleventh test to sign in is refused by
       * a limit the ten before it earned (`start/limiter.ts`), and the
       * failure lands nowhere near the change that caused it.
       */
      group.each.setup(() => limiter.clear())
      group.each.setup(() => testUtils.db().truncate())
    })
  }
}
