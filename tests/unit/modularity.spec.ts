import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { test } from '@japa/runner'

/**
 * The architecture rule that makes a feature module removable (plan D8,
 * docs/modules.md).
 *
 * Core reaches a module **only through registration**: the quota, dashboard,
 * job, API-surface, route and seeder registries, plus the schema-rules path
 * in `config/database.ts`. Nothing else may import one.
 *
 * That property held when it was built and nothing kept it holding — the
 * first careless `import lists from '#modules/lists/services/list_service'`
 * in a core service would quietly restore the coupling that four rounds of
 * work removed, and no existing test would notice. This is the test that
 * notices.
 */

/**
 * Where a module may be reached from, and by what.
 *
 * Adding a file here is a deliberate act: it means core now depends on a
 * module somewhere new, and whoever removes that module has one more place
 * to edit. Prefer a registry.
 */
const REGISTRATION_POINTS = new Set([
  'start/quotas.ts',
  'start/dashboard.ts',
  'start/api.ts',
  'start/jobs.ts',
  'start/seeders.ts',
  'start/routes/web.ts',
  'start/routes/api.ts',

  /**
   * Not an import — lucid resolves this path itself, from
   * `schemaGeneration.rulesPaths`.
   */
  'config/database.ts',
])

/**
 * Directories that are core, and are therefore subject to the rule. `tests/`
 * is deliberately absent: the suites use the demo domain as their worked
 * example, which docs/modules.md explains and step 4 of that page is about.
 */
const CORE_ROOTS = ['app', 'start', 'config', 'commands', 'database']

/**
 * A real module specifier, not a mention of one in a comment. Both forms the
 * codebase uses: a static `from '#modules/…'` and a dynamic
 * `import('#modules/…')`.
 */
const MODULE_IMPORT = /(?:from\s*|import\s*\(\s*)['"]#modules\//

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = []

  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)

      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.name.endsWith('.ts')) {
        found.push(path)
      }
    }
  }

  await walk(root)

  return found
}

test.group('Modularity', () => {
  test('only the registration points import a feature module', async ({ assert }) => {
    const offenders: string[] = []

    for (const root of CORE_ROOTS) {
      for (const path of await sourceFiles(root)) {
        /**
         * A module is allowed to import itself and its siblings.
         */
        if (path.startsWith(join('app', 'modules'))) {
          continue
        }

        if (REGISTRATION_POINTS.has(path)) {
          continue
        }

        if (MODULE_IMPORT.test(await readFile(path, 'utf8'))) {
          offenders.push(path)
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'these reach into a feature module without going through a registry — see docs/modules.md'
    )
  })

  /**
   * The other direction: every registration point must still be one. A
   * registry file that stopped importing its module would mean the feature
   * had silently stopped being registered, which is the failure mode every
   * registry in this application is shaped to avoid.
   */
  test('every registration point actually registers something', async ({ assert }) => {
    for (const path of REGISTRATION_POINTS) {
      const source = await readFile(path, 'utf8')

      assert.include(
        source,
        '#modules/',
        `${path} is listed as a registration point but reaches no module`
      )
    }
  })

  /**
   * `app/modules/lists/` is the shape a replacement copies, so its pieces
   * being where docs/modules.md says they are is part of the contract.
   */
  test('the demo module holds its own everything', async ({ assert }) => {
    const paths = await sourceFiles(join('app', 'modules', 'lists'))
    const relative = paths.map((path) => path.replace(/\\/g, '/'))

    for (const expected of [
      'app/modules/lists/models/todo_list.ts',
      'app/modules/lists/services/list_service.ts',
      'app/modules/lists/controllers/list_controller.ts',
      'app/modules/lists/controllers/api/list_controller.ts',
      'app/modules/lists/policies/todo_list_policy.ts',
      'app/modules/lists/transformers/todo_list_transformer.ts',
      'app/modules/lists/jobs/overdue_digest_job.ts',
      'app/modules/lists/mails/overdue_digest_notification.ts',
      'app/modules/lists/api_scopes.ts',
      'app/modules/lists/openapi.ts',
      'app/modules/lists/routes.ts',
      'app/modules/lists/schema_rules.ts',
      'app/modules/lists/seeder.ts',
      'app/modules/lists/validators.ts',
    ]) {
      assert.include(relative, expected)
    }
  })
})
