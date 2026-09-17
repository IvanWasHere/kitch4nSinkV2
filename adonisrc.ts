import { indexEntities } from '@adonisjs/core'
import { defineConfig } from '@adonisjs/core/app'
import { indexPolicies } from '@adonisjs/bouncer'

import { serverStatsEnabled } from '#start/dev_toolbar'

export default defineConfig({
  /*
  |--------------------------------------------------------------------------
  | Experimental flags
  |--------------------------------------------------------------------------
  |
  | The following features will be enabled by default in the next major release
  | of AdonisJS. You can opt into them today to avoid any breaking changes
  | during upgrade.
  |
  */
  experimental: {},

  /*
  |--------------------------------------------------------------------------
  | Commands
  |--------------------------------------------------------------------------
  |
  | List of ace commands to register from packages. The application commands
  | will be scanned automatically from the "./commands" directory.
  |
  */
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@adonisjs/session/commands'),
    () => import('@adonisjs/bouncer/commands'),
    () => import('@adonisjs/mail/commands'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Service providers
  |--------------------------------------------------------------------------
  |
  | List of service providers to import and register when booting the
  | application
  |
  */
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    {
      file: () => import('@adonisjs/core/providers/repl_provider'),
      environment: ['repl', 'test'],
    },
    () => import('@adonisjs/core/providers/vinejs_provider'),
    () => import('@adonisjs/core/providers/edge_provider'),
    () => import('@adonisjs/session/session_provider'),
    () => import('@adonisjs/vite/vite_provider'),
    () => import('@adonisjs/shield/shield_provider'),
    () => import('@adonisjs/static/static_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/auth/auth_provider'),
    () => import('@adonisjs/bouncer/bouncer_provider'),
    () => import('@adonisjs/mail/mail_provider'),
    () => import('@adonisjs/ally/ally_provider'),
    () => import('@adonisjs/drive/drive_provider'),
    () => import('@adonisjs/limiter/limiter_provider'),

    /**
     * The development toolbar (`#start/dev_toolbar`). It registers its own
     * routes — `/admin/api/server-stats`, `/admin/api/debug/*`, `/__stats/*`
     * — so there is nothing to add to `#start/routes`.
     *
     * Spread out of an array rather than listed like the others, because the
     * specifier must not be *evaluated* in an image built without dev
     * dependencies. Restricted to `web` so `node ace` and the test runner do
     * not pay for a metrics engine neither of them displays.
     */
    ...(serverStatsEnabled
      ? [
          {
            file: () => import('adonisjs-server-stats/provider'),
            environment: ['web' as const],
          },
        ]
      : []),
  ],

  /*
  |--------------------------------------------------------------------------
  | Preloads
  |--------------------------------------------------------------------------
  |
  | List of modules to import before starting the application.
  |
  */
  preloads: [
    () => import('#start/routes'),
    () => import('#start/kernel'),
    () => import('#start/validator'),

    /**
     * The feature registries, before the view layer: a rendered page reads
     * plan usage, the Overview screen renders widgets, and the API's scopes
     * and spec are whatever these files register.
     */
    () => import('#start/quotas'),
    () => import('#start/dashboard'),
    () => import('#start/api'),
    () => import('#start/jobs'),
    () => import('#start/view'),
  ],

  /*
  |--------------------------------------------------------------------------
  | Tests
  |--------------------------------------------------------------------------
  |
  | List of test suites to organize tests by their type. Feel free to remove
  | and add additional suites.
  |
  */
  tests: {
    suites: [
      /**
       * Each suite also globs the matching directory under a feature
       * module's own `tests` folder, so a module carries its tests and they
       * run in the suite they belong to (docs/modules.md).
       */
      {
        files: ['tests/unit/**/*.spec.ts', 'app/modules/*/tests/unit/**/*.spec.ts'],
        name: 'unit',
        timeout: 2000,
      },
      {
        files: ['tests/functional/**/*.spec.ts', 'app/modules/*/tests/functional/**/*.spec.ts'],
        name: 'functional',
        timeout: 30000,
      },
      {
        files: ['tests/browser/**/*.spec.ts'],
        name: 'browser',
        timeout: 300000,
      },
    ],
    forceExit: false,
  },

  /*
  |--------------------------------------------------------------------------
  | Meta files
  |--------------------------------------------------------------------------
  |
  | A collection of files you want to copy to the build folder when creating
  | a production build.
  |
  */
  metaFiles: [
    {
      pattern: 'resources/views/**/*.edge',
      reloadServer: false,
    },
    {
      pattern: 'public/**',
      reloadServer: false,
    },
  ],

  /*
  |--------------------------------------------------------------------------
  | Hooks
  |--------------------------------------------------------------------------
  |
  | Assembler hooks are executed by the Assembler dev tool during various
  | stages. Assembler is responsible for running the dev-server, tests, and
  | creating production builds. These hooks run in a separate process than
  | the main AdonisJS app.
  |
  */
  hooks: {
    /*
    |------------------------------------------------------------------------
    | Generated barrels
    |------------------------------------------------------------------------
    |
    | Both indexes scan `app/` rather than `app/controllers` and
    | `app/policies`, so a feature module under `app/modules/<name>/` is
    | picked up alongside core (docs/modules.md). Three details make that
    | work, and each was arrived at by trying the alternative:
    |
    |   importAlias '#app'  — the paths the index emits must resolve from
    |                         `app/`, so `#controllers` cannot be it.
    |   skipSegments        — drops `controllers` and `modules` from the keys,
    |                         so a module's controller is
    |                         `controllers.lists.List` rather than
    |                         `controllers.modules.lists.List`.
    |   the policy glob     — matched against the whole path, so it needs a
    |                         leading globstar; and it names `policies` as a
    |                         directory rather than matching every file, so
    |                         that `app/admin/staff_policy.ts` stays out. A
    |                         `StaffUser` policy in the tenant registry makes
    |                         the map incompatible with a `User` actor and
    |                         every tenant policy silently drops out of the
    |                         type-level action list (see
    |                         `app/admin/staff_policies.ts`). Negated patterns
    |                         are not an option — a single excluding entry
    |                         makes the whole set match everything.
    |
    */
    init: [
      indexEntities({
        controllers: {
          source: 'app',
          importAlias: '#app',
          glob: ['**/*_controller.ts'],
          skipSegments: ['controllers', 'modules'],
        },
      }),
      indexPolicies({
        source: 'app',
        importAlias: '#app',
        glob: ['**/policies/*_policy.ts'],
      }),
    ],
    buildStarting: [() => import('@adonisjs/vite/build_hook')],
  },
})
