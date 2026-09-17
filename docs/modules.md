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
Nothing here is a plugin system. The demo domain is ordinary application code that happens to be
confined to a known set of files, and this page is the map. Removing it is a mechanical job of about
twenty minutes, and the test suite tells you when you are done.

---

## What is already independent

Five things mean removal is smaller than it looks.

**Nothing in `app/` imports the demo domain.** Not `PlanService`, not the dashboard controller, not
a transformer or a template outside the domain's own screens. The only files that name it are the
six registries in step 2, `commands/dev_seed.ts`, and the domain's own files. That is the property
everything below rests on, and `grep -rl '#todos/' app/` is how you check it still holds.

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

**The dependency direction is inward.** Everything under `app/todos/`, plus the domain's
controllers, models, policies and transformers, imports *core* (`#billing/plan_service`,
`#api/cursor`, `#models/organization`) and never the other way about. In particular
`app/billing/plan_service.ts`, which used to import `#models/todo_list` in order to count lists, no
longer knows the domain exists.

---

## Step 1 — delete the files

Every file here exists only for lists and todos. None of them is imported by anything outside this
list except through the registrations in step 2.

```
app/todos/                                          the domain services
app/models/todo.ts
app/models/todo_list.ts
app/controllers/todos/                              the web screens
app/controllers/api/v1/list_controller.ts           the API endpoints
app/controllers/api/v1/todo_controller.ts
app/policies/todo_list_policy.ts
app/policies/todo_policy.ts
app/transformers/todo_list_transformer.ts
app/transformers/todo_transformer.ts
app/validators/todo.ts
app/queue/jobs/overdue_digest_job.ts                the three domain jobs
app/queue/jobs/reconcile_counters_job.ts
app/queue/jobs/normalize_positions_job.ts
app/mail/mails/overdue_digest_notification.ts
resources/views/pages/lists/                         screens + dashboard widget partials
resources/views/emails/overdue_digest.edge
resources/views/emails/overdue_digest_text.edge
database/migrations/1788600000007_create_todo_lists_table.ts
database/migrations/1788600000008_create_todos_table.ts
database/todo_schema_rules.ts                       its two tables' column rules
tests/functional/todos/
tests/unit/position.spec.ts
docs/lists-and-todos.md
```

The two migrations sit in the middle of the sequence, which is safe: nothing after them references
either table. `files.attachable_type` is `User | Organization | SupportMessage`, so no upload points
at a todo.

{: .warning }
Deleting the migrations only affects a database built from scratch. An existing one keeps both
tables until you migrate them away — add a migration that drops them, rather than editing history.

---

## Step 2 — unregister it

Six places name the domain. Every one is an explicit registry, so every one is a deletion rather
than a rewrite — **there is nothing left in `app/` to edit.**

| File | What to remove |
|---|---|
| `start/quotas.ts` | the `lists` and `todosPerList` registrations |
| `start/dashboard.ts` | the three widget registrations |
| `start/api.ts` | the demo-domain block: the scope loop and `openApi.register(listOpenApi)` |
| `start/routes/web.ts` | the `lists.*` and `todos.*` route block |
| `start/routes/api.ts` | the `/lists` and `/todos` route block |
| `app/queue/registry.ts` | the three job imports and their `jobHandlers` entries |
| `commands/schedule_run.ts` | the three imports and their entries in the schedule table |

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
`app/todos/api_scopes.ts` carries the type augmentation that puts those scopes into `ApiScope`,
deleting it is also what makes a leftover `requireScope(ctx, 'lists:read')` **fail to compile**
rather than fail at runtime.

There is one edit outside the registries: `config/database.ts` lists
`#database/todo_schema_rules` in `schemaGeneration.rulesPaths` for both connections. Drop it when
you delete that file.

None of the files those registrations feed mentions a list.

---

## Step 3 — remove the vocabulary

These compile without the domain, but leave `lists` and `todos` in core forever if you skip them.

**`config/plans.ts`** — drop `lists` and `todosPerList` from `PlanLimits`, from all three plan
tiers, and from `LIMIT_NOUNS`, then add whatever your product actually meters. `LIMIT_NOUNS` is
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
| `app/api/openapi.ts` | core paths plus `openApi.paths()`; the demo domain's are in `app/todos/openapi.ts` |
| `app/validators/api.ts` | keeps `createApiKeyValidator`; the four list/todo bodies live in `#validators/todo` |
| `database/schema_rules.ts` | core tables only; the `color` and `priority` unions are in `database/todo_schema_rules.ts` |
| `app/transformers/organization_transformer.ts` | builds the usage payload from the quota registry |
| `app/exceptions/plan_limit_exceeded_exception.ts` | takes its wording from `LIMIT_NOUNS` |

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

## Adding your resource to the API

Three pieces: the scopes, the request bodies, and the spec.

**1. Declare and describe the scopes.** The augmentation is what keeps `ApiScope` a closed union,
so `requireScope` stays a compile-time check:

```ts
// app/projects/api_scopes.ts
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
// app/projects/openapi.ts
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

## Step 4 — the tests

`tests/functional/todos/` and `tests/unit/position.spec.ts` go with the domain. The rest use lists
as their worked example, so they need the example **replaced** rather than deleted — otherwise you
lose the coverage instead of moving it:

| Suite | What it asserts through lists |
|---|---|
| `tests/functional/tenant_isolation.spec.ts` | that one workspace can never reach another's rows, endpoint by endpoint |
| `tests/functional/api/endpoints.spec.ts` | pagination, scopes, cursors and error shapes |
| `tests/functional/billing/quotas.spec.ts` | the row-locked create at the cap, and the at-cap banner |
| `tests/browser/workspace.spec.ts` | the real-browser walk through the app |
| `tests/unit/plan_service.spec.ts` | limits, overrides and the 402 details, all keyed on `lists` |
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

`commands/dev_seed.ts` builds the demo workspaces out of lists and todos, so it needs rewriting for
your domain before `node ace dev:seed` will run. `database/seeders/test_accounts_seeder.ts` is core
and does not.

If `npm run typecheck` is clean and the suite passes, the domain is gone.
