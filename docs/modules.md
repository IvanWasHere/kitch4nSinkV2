---
title: Replacing the demo domain
nav_order: 15
---

# Replacing the demo domain

Lists and todos are the **demo domain** (plan D8). They exist so that tenancy, quotas, the API and
the back office have something real to act on — three differently-shaped limits (`lists`,
`todosPerList`, and a per-list counter), a worked API resource, and a screen with a meter on it.
They are not meant to be your product.

This page is the removal path: what to delete, what to edit, and what is deliberately left alone.

{: .note }
Nothing here is a plugin system. The demo domain is ordinary application code that lives in one
folder and registers itself in seven explicit places, and this page is the map. Removing it is a
mechanical job of about twenty minutes, and the test suite tells you when you are done.

---

## What is already independent

Seven things mean removal is smaller than it looks.

**A test enforces all of it.** `tests/unit/modularity.spec.ts` asserts that nothing outside the
registration points imports `#modules/…`, and that each registration point still registers
something. The properties below are not conventions anyone has to remember — they fail the suite
when they break.

**It lives in one folder.** `app/modules/lists/` holds its models, services, controllers, policies,
transformers, jobs, mails, validators, routes, API surface, schema rules and tests. Nothing else in
`app/` is part of it.

**Nothing in core imports it.** Not `PlanService`, not the dashboard controller, not a transformer
or a template outside its own screens. The only files that name it are the seven registration
points in step 2, `commands/dev_seed.ts`, and its own files. That is the property everything below
rests on, and `grep -rl '#modules/lists' app start config database commands` is how you check it
still holds.

**The generated barrels find it.** `indexEntities` and `indexPolicies` in `adonisrc.ts` scan `app/`
rather than `app/controllers` and `app/policies`, so a module's controllers and policies are indexed
alongside core's — `controllers.lists.List`, `controllers.lists.api.List`. That configuration has
three non-obvious details, explained in a comment there; the important one is that the policy glob
names `policies` as a directory so `app/admin/staff_policy.ts` stays out of the tenant registry.

**Quotas are registered, not hardcoded.** `PlanService` owns the arithmetic — the amber-at-80% rule,
the row lock inside a create, the `>=` that makes a downgraded workspace read as full — and knows
nothing about what is being counted. Each quota is registered in `start/quotas.ts` with a label and
a counter, and everything downstream iterates that: the meter grids on the dashboard, billing and
back-office screens, the at-cap banner, and the API's usage payload. **Deleting a quota's
registration removes it from all of them with no further edit.**

**The navigation is route-guarded.** Every item in `resources/views/partials/app_nav.edge` is wrapped
in `hasRoute(...)`, a view global defined in `start/view.ts`. Delete the `lists.*` routes and *Lists*
disappears from the sidebar with no template edit. The `navItem` and `usageMeter` components already
treat a missing `usage` as absent rather than as zero.

**The controller and policy barrels are generated.** `indexEntities()` and `indexPolicies()` in
`adonisrc.ts` rebuild `#generated/controllers` and `#generated/policies` by scanning
`app/controllers/` and `app/policies/`. Delete the files and the barrels follow.

**The Overview screen holds no queries.** `DashboardController` is four lines: it loads whatever
`start/dashboard.ts` registers and hands it to the template, which renders each widget's partial
through a dynamic `@include`. The screen names nothing it shows, so it survives its widgets being
deleted.

**The dependency direction is inward.** Everything in `app/modules/lists/` imports *core*
(`#billing/plan_service`, `#api/cursor`, `#models/organization`) and never the other way about. In
particular `app/billing/plan_service.ts`, which used to import `#models/todo_list` in order to
count lists, no longer knows the domain exists.

---

## Step 1 — delete the module

Almost all of it is one folder:

```
app/modules/lists/
  models/          todo_list, todo
  services/        list, todo, dashboard, position
  controllers/     the web screens, and api/ for /api/v1
  policies/        todo_list, todo
  transformers/    todo_list, todo
  jobs/            overdue_digest, reconcile_counters, normalize_positions
  mails/           overdue_digest_notification
  tests/           unit/ and functional/, run by the matching suite
  api_scopes.ts    the scopes, and the augmentation that types them
  openapi.ts       its half of the published spec
  routes.ts        registered from inside core's groups
  seeder.ts        its share of `node ace dev:seed`
  schema_rules.ts  its two tables' column rules
  validators.ts    web and API request bodies
```

`rm -rf app/modules/lists` is the bulk of the removal. Three things live outside it, each for a
reason:

| Outside the module | Why |
|---|---|
| `resources/views/pages/lists/` — its screens, emails and dashboard widget partials | Edge resolves templates from `resources/views`; a second root would mean renaming every `view.render` call for no real gain. It is one folder to delete. |
| `resources/views/emails/overdue_digest*.edge` | Same. |
| `database/migrations/…_create_todo_lists_table.ts` and `…_create_todos_table.ts` | **Do not move these.** Lucid records a migration by its *path* (`database/migrations/1788600000007_create_todo_lists_table`), so relocating a file makes it look like a new migration and re-runs it against a database that already has the table. Tests would stay green — they migrate from scratch — while every existing install broke. |

{: .warning }
Deleting the migrations only affects a database built from scratch. An existing one keeps both
tables until you migrate them away — add a migration that drops them, rather than editing history.

Also delete `docs/lists-and-todos.md`. `commands/dev_seed.ts` needs **no** edit: the demo
domain's share of the dataset is `app/modules/lists/seeder.ts`, registered in `start/seeders.ts`,
so `dev:seed` keeps building a complete demo of everything core has.

{: .note }
Your own feature goes in the same shape: `app/modules/<name>/`, imported as `#modules/<name>/…`.
The barrels pick up its controllers and policies automatically, its tests join the existing suites,
and the sections below are the seven places it registers itself. Its bouncer policy keys are
generated from the path — `app/modules/lists/policies/todo_policy.ts` becomes
`ModulesListsTodoPolicy` — which is verbose but generated, and TypeScript completes it.

---

## Step 2 — unregister it

Eight places name the domain. Every one is an explicit registration, so every one is a deletion
rather than a rewrite — **there is nothing left in `app/` outside the module to edit.**

Each is a block plus the import that feeds it — drop both, or `tsc` will tell you about the unused
one.

| File | What to remove |
|---|---|
| `start/quotas.ts` | the `lists` and `todosPerList` registrations |
| `start/dashboard.ts` | the three widget registrations |
| `start/api.ts` | the demo-domain block: the scope loop and `openApi.register(listOpenApi)` |
| `start/jobs.ts` | the three job imports and registrations |
| `start/seeders.ts` | the `listsDemoSeeder` registration and its import |
| `start/routes/web.ts` | the `registerListWebRoutes()` call and its import |
| `start/routes/api.ts` | the `registerListApiRoutes()` call and its import |
| `config/database.ts` | `#modules/lists/schema_rules` in `rulesPaths`, on both connections |

Deleting the `start/quotas.ts` lines removes the Lists meter from the dashboard, the billing screen
and the back office, drops `lists` from the API's usage payload, and takes the `lists` case out of
the at-cap banner.

Deleting the `start/dashboard.ts` lines empties the Overview screen of its figures, its recent-todo
table and its activity feed. The usage meters stay, because they are the page's own shell rather
than a widget, and with nothing registered the page renders a hint instead of breaking —
`tests/functional/dashboard.spec.ts` covers exactly that case. You will want to register widgets of
your own; see below.

Deleting the `start/api.ts` block removes `lists:*` and `todos:*` from the key-creation form, from
the key validator's accepted values, and from `/openapi.json` and `/docs`. Because
`app/modules/lists/api_scopes.ts` carries the type augmentation that puts those scopes into `ApiScope`,
deleting it is also what makes a leftover `requireScope(ctx, 'lists:read')` **fail to compile**
rather than fail at runtime.

Deleting the `start/jobs.ts` block stops the worker accepting those three jobs and stops
`schedule:run` dispatching them. `tests/unit/jobs.spec.ts` reads `app/queue/jobs/` from disk and
asserts every handler there is registered, so a job file left behind without its registration fails
a test rather than sitting in the queue forever.

The routes live in `app/modules/lists/routes.ts` and are exported as functions that core calls from
*inside* its own groups. That is deliberate: both groups carry a middleware stack — a verified
tenant session for the web, key auth plus usage tracking and rate limiting for the API — and the
uniformity of those stacks is what makes it impossible to add a screen or an endpoint that forgets
to scope itself to an organisation. A module registering its own group could get that wrong
privately.

None of the files those registrations feed mentions a list.

---

## Step 3 — remove the vocabulary

These compile without the domain, but leave `lists` and `todos` in core forever if you skip them.

**`config/plans.ts`** — drop `lists` and `todosPerList` from `PlanLimits`, from all three plan
tiers, from `LIMIT_NOUNS` and from `PLAN_CARD_LIMITS`, then add whatever your product actually
meters. `PLAN_CARD_LIMITS` is what the pricing grid lists, in its order; a limit left out of it is
still enforced, just not advertised as a number — `apiKeys` is sold as the `api` feature instead. `LIMIT_NOUNS` is
typed as an exhaustive `Record<LimitKey, string>`, so a limit you add without a word for it is a
compile error rather than a `402` that reads "you have used all 5 projects".

Everything downstream follows from this one file: `LIMIT_KEYS` is derived from it, so the staff
override form in `resources/views/pages/admin/organizations/show.edge` re-populates itself, the
server-side check in `AdminOrganizationController.overrideLimits` reads the same object, and
`PlanLimitExceededException` takes its wording from `LIMIT_NOUNS`.

**`app/models/public_id.ts`** — remove the `todoList: 'lst'` and `todo: 'tdo'` prefixes and add
your own. Deliberately a plain object rather than a registry: a model's `withPublicId('todoList')`
runs when the class is defined, so a prefix registered by a preload could be missing at exactly the
wrong moment and mint an `undefined_…` id. A constant is complete before any model loads, and it is
what makes `tests/unit/public_id.spec.ts`'s exhaustive pass cover your resource.

And that is the whole of step 3. Everything else that used to be listed here is now registry-driven
and needs **no** edit:

| File | Why it no longer needs one |
|---|---|
| `app/api/scopes.ts` | holds what a scope *is*, not which ones exist — those come from `start/api.ts` |
| `app/api/openapi.ts` | core paths plus `openApi.paths()`; the demo domain's are in `app/modules/lists/openapi.ts` |
| `app/validators/api.ts` | keeps `createApiKeyValidator`; the four list/todo bodies live in `#validators/todo` |
| `database/schema_rules.ts` | core tables only; the `color` and `priority` unions are in `app/modules/lists/schema_rules.ts` |
| `app/transformers/organization_transformer.ts` | builds the usage payload from the quota registry |
| `app/exceptions/plan_limit_exceeded_exception.ts` | takes its wording from `LIMIT_NOUNS` |
| `app/queue/registry.ts` | owns the lookup and the schedule filter, not the list of jobs |
| `commands/schedule_run.ts` | asks the registry what is due on this tick |
| `resources/views/pages/billing/index.edge` | the plan grid's numbered bullets come from `PLAN_CARD_LIMITS` |

`tests/functional/api/endpoints.spec.ts` asserts the document's schema list and the exact quota key
set, which is where you will be told the published API changed.

---

## Adding a quota of your own

The reverse of step 2, and the shape your own product's limits take. Say you meter projects:

**1. Declare the limit** in `config/plans.ts` — a `projects` field on `PlanLimits`, a number on each
plan tier, and a noun in `LIMIT_NOUNS`. `LimitKey` and `LIMIT_KEYS` derive from this, so the staff
override form and the enforcement check pick it up at once.

**2. Write the counter** on the service that owns the table, beside the create it guards:

```ts
async count(organization: Organization, trx?: TransactionClientContract): Promise<number> {
  const [row] = await Project.query(trx ? { client: trx } : {})
    .where('organization_id', organization.id)
    .whereNull('deleted_at')
    .count('* as total')

  return Number(row.$extras.total)
}
```

**3. Register it** in `start/quotas.ts`, in the position you want its meter to appear:

```ts
quotas.register({
  key: 'projects',
  label: 'Projects',
  count: (organization, trx) => projects.count(organization, trx),
})
```

**4. Enforce it** inside the create's own transaction, which is the part that makes the limit real:

```ts
return db.transaction(async (trx) => {
  await plans.lockAndAssertLimit(trx, organization, 'projects', (client) =>
    this.count(organization, client)
  )
  // …insert
})
```

That is all of it. The meter appears on the dashboard, the billing screen and the back office; the
at-cap banner names it when it is full; `GET /api/v1/organization` reports its headroom; and a
blocked create returns a `402` that says "Your plan allows 5 projects, and you are using 5."

{: .warning }
`lockAndAssertLimit` locks the organisation row and *then* counts, so two simultaneous creates
cannot both take the last slot. Counting outside the transaction — or checking before opening one —
is the bug this method exists to prevent, and it only shows up under concurrency on Postgres.

A limit with no single number per workspace is registered without a `count`, the way `todosPerList`
is: it still gets a noun, a `402` and a line in the API's usage payload, but nothing tries to meter
it.

---

## Adding a dashboard widget

The Overview screen is whatever its widgets say. There are two regions — `stats`, the row of
figures across the top, and `panels`, the grid beneath the usage meters — and a widget is a loader
plus a partial:

```ts
// start/dashboard.ts
dashboard.register({
  key: 'project_stats',
  region: 'stats',
  partial: 'pages/projects/widgets/stats',
  load: (organization) => projects.statsFor(organization),
})
```

The partial is rendered with the page's scope plus a `widget` local, so it reads its own data as
`widget.data`:

```edge
@let(stats = widget.data)

@!statCard({ label: 'Projects', value: stats.total, icon: 'folder', tone: 'blue' })
```

Registration order is render order within a region. A widget with no `load` gets `data: null`,
which is what you want for something static.

{: .warning }
Every widget's `load` runs in parallel, but they all run on the screen a customer lands on after
signing in. Keep each one to bounded, indexed queries — the dashboard is the easiest place in the
application to accidentally put a table scan.

---

## Adding a background job

Write the handler in `app/queue/jobs/`, then register it in `start/jobs.ts`:

```ts
jobs.register(rebuildProjectIndexJob, { interval: 'daily', label: 'rebuild project index' })
```

Omit the schedule for a job your own code dispatches rather than cron. The `label` is what
`schedule:run` prints, so write it for the operator reading that output, not as the job's key.

{: .warning }
Delivery is **at-least-once** — a worker that crashes after doing the work but before marking the
job done will run it again. Every handler must be idempotent. And `handler.name` is stored in
`jobs.name`, so renaming one strands the rows already queued under the old name: treat it as
permanent.

---

## Adding your resource to the API

Three pieces: the scopes, the request bodies, and the spec.

**1. Declare and describe the scopes.** The augmentation is what keeps `ApiScope` a closed union,
so `requireScope` stays a compile-time check:

```ts
// app/modules/projects/api_scopes.ts
declare module '#api/scopes' {
  interface ApiScopes {
    'projects:read': true
    'projects:write': true
  }
}

export const projectApiScopes: [ApiScope, ScopeDefinition][] = [
  ['projects:read', { description: 'Read projects', default: true }],
  ['projects:write', { description: 'Create, rename and delete projects' }],
]
```

`default: true` is what a key gets when the caller does not choose, so only ever put a read scope
there — it is the safe default for something about to be pasted into a script.

**2. Put the request bodies with the feature**, not in `#validators/api`. Keys are snake_case,
matching what the transformers emit, so a client can `PATCH` back a field it just read.

**3. Contribute the spec.** Import the shared fragments so your endpoints are documented the way
core's are, and export one `OpenApiContribution`:

```ts
// app/modules/projects/openapi.ts
export const projectOpenApi: OpenApiContribution = {
  schemas: { Project: projectSchema },
  paths: {
    '/projects': {
      get: { summary: 'List projects', parameters: [...cursorParams], responses: { … } },
      post: { summary: 'Create a project', responses: { …planLimitResponse, …commonResponses } },
    },
  },
}
```

**Then register both** in `start/api.ts`, and add the routes to `start/routes/api.ts`.

{: .warning }
Anything that reads the scope registry must read it **lazily**. `createApiKeyValidator` uses
`vine.enum(() => scopes.all())` rather than passing the array, because a validator defined at
module load would capture the registry before `start/api.ts` filled it — and silently accept
nothing.

---

## Adding your own demo data

`node ace dev:seed` builds the workspaces, the people, the subscriptions, the announcements and the
operations rows. It does not know what your rows look like, so a feature fills them itself:

```ts
// app/modules/projects/seeder.ts
export const projectsDemoSeeder: DemoSeeder = {
  key: 'projects',

  /**
   * A meter is only worth showing near its ceiling, and a plan's real
   * ceiling is usually too high to demonstrate against.
   */
  overrides: { free: { tasksPerProject: 12 } },

  async seed({ free, pro }) {
    await fill(free.organization, free.owner, free.members[0])
    await fill(pro.organization, pro.owner, pro.members[0], pro.members[1])
  },
}
```

Register it in `start/seeders.ts`. You are handed two workspaces — `free` (Acme, deliberately at
its caps) and `pro` (the one the demo is toured in) — each with its `organization`, `owner` and
`members` in join order. Seeders run after every workspace and person exists, so you can assign a
row to a member and know they are there; `overrides` are merged over whatever core already set,
never replacing it.

---

## Step 4 — the tests

The module's own tests are in `app/modules/lists/tests/`, and each suite in `adonisrc.ts` globs the
matching directory under a module, so they run as `unit` and `functional` exactly as core's do.
They go when the folder goes.

The suites below are core's, and they use lists as their worked example — so they need the example
**replaced** rather than deleted, or you lose the coverage instead of moving it:

| Suite | What it asserts through lists |
|---|---|
| `tests/functional/tenant_isolation.spec.ts` | that one workspace can never reach another's rows, endpoint by endpoint |
| `tests/functional/api/endpoints.spec.ts` | pagination, scopes, cursors and error shapes |
| `tests/functional/billing/quotas.spec.ts` | the row-locked create at the cap, and the at-cap banner |
| `tests/browser/workspace.spec.ts` | the real-browser walk through the app |
| `tests/unit/plan_service.spec.ts` | limits, overrides and the 402 details, all keyed on `lists` |
| `tests/unit/seats.spec.ts` | uses `lists` as the limit it overrides while testing seats |
| `tests/unit/api.spec.ts` | scope parsing, using `lists:read` and `todos:read` as the literals |
| `tests/unit/public_id.spec.ts` | prefix parsing — iterates the registry, but also names `todo` and `todoList` directly in four assertions |
| `tests/functional/dashboard.spec.ts` | that every registered widget renders — and that the screen still renders with none |
| `tests/functional/admin/back_office.spec.ts`, `tests/functional/api/auth.spec.ts`, `tests/functional/billing/webhooks.spec.ts` | incidental — they create a list to have a row to act on |

**`tests/helpers.ts` exports `createList()`, and that is the seam.** Every suite above uses it as
its tenant-owned resource. Rewrite that one function's body to create yours and most of the suites
follow with no other edit — which is why it lives in the file they all already import rather than
in a domain-specific helper file.

`tests/functional/dashboard.spec.ts` asserts on widget *content*, so it needs your widget's copy
rather than the demo domain's. Its second test — the screen with an empty registry — is core and
should be kept as it is.

{: .note }
The isolation suite is the one to port rather than rewrite. Its demo-domain block is marked off by
a section banner naming exactly where it starts and ends. Those cases are not generic cases in list
clothing — each argues a different way a tenant-owned resource leaks — so they are deliberately
not abstracted behind an endpoint table, and a new domain with no equivalent is the single easiest
way to undo the value of this starter.

---

## What is deliberately left alone

**The CSS has no list-specific classes.** `resources/css/components/cards.css` and `buttons.css`
mention todos only in comments — the classes themselves (`.card-stripe-*`, the count pill, the
at-cap `:disabled` style) are generic and worth keeping.

**Marketing and email copy** mentions lists in passing: `resources/views/pages/home.edge`, the
billing emails, `resources/views/partials/account_banner.edge`'s `past_due` message, and the plan
card descriptions in `resources/views/pages/billing/index.edge`. None of it breaks. Rewrite it when
you write your own product's copy.

**Quota reads in shared templates are already guarded.** The at-cap banner, the billing meters and
the back-office meters test for `usage.lists` before using it, so a build without the domain renders
the quotas it does have instead of failing. If you add a quota of your own, follow that pattern —
Edge's expression parser is a subset of JavaScript and these templates use plain `&&` rather than
optional chaining on purpose.

---

## Checking your work

```bash
npm run typecheck      # catches every missed import
npm run lint
node ace test          # the suite is the real answer
node ace migration:fresh --seed
```

Done properly, `npm run typecheck` after the removal reports errors in **only two places**:
`commands/dev_seed.ts`, which needs rewriting for your domain, and the core test suites listed
above, which need their worked example replaced. Nothing in `app/`, `start/` or `config/` should
fail — if something does, it is a coupling this page has missed.

`commands/dev_seed.ts` builds the demo workspaces out of lists and todos, so it needs rewriting for
your domain before `node ace dev:seed` will run. `database/seeders/test_accounts_seeder.ts` is core
and does not.

If `npm run typecheck` is clean and the suite passes, the domain is gone.
