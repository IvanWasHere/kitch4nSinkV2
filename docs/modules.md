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

Three things mean removal is smaller than it looks.

**The navigation is route-guarded.** Every item in `resources/views/partials/app_nav.edge` is wrapped
in `hasRoute(...)`, a view global defined in `start/view.ts`. Delete the `lists.*` routes and *Lists*
disappears from the sidebar with no template edit. The `navItem` and `usageMeter` components already
treat a missing `usage` as absent rather than as zero.

**The controller and policy barrels are generated.** `indexEntities()` and `indexPolicies()` in
`adonisrc.ts` rebuild `#generated/controllers` and `#generated/policies` by scanning
`app/controllers/` and `app/policies/`. Delete the files and the barrels follow.

**The dependency direction is already inward.** Everything under `app/todos/`, plus the domain's
controllers, models, policies and transformers, imports *core* (`#billing/plan_service`,
`#api/cursor`, `#models/organization`). Core imports the domain in only four places, listed below.

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
resources/views/pages/lists/
resources/views/emails/overdue_digest.edge
resources/views/emails/overdue_digest_text.edge
database/migrations/1788600000007_create_todo_lists_table.ts
database/migrations/1788600000008_create_todos_table.ts
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

Four places in core import the domain. Each is an explicit registry, so each is a deletion rather
than a rewrite.

| File | What to remove |
|---|---|
| `start/routes/web.ts` | the `lists.*` and `todos.*` route block |
| `start/routes/api.ts` | the `/lists` and `/todos` route block |
| `app/queue/registry.ts` | the three job imports and their `jobHandlers` entries |
| `commands/schedule_run.ts` | the three imports and their entries in the schedule table |

Then the two remaining reverse dependencies, which need a little more than a deletion:

**`app/billing/plan_service.ts`** imports `#models/todo_list` to count lists. Remove `listCount()`,
`todoUsage()`, the `lists` field on `PlanUsage`, and the `lists` entry in `usage()`. `seats` and
`storage` are core and stay.

**`app/controllers/dashboard_controller.ts`** imports `#todos/dashboard_service`, and
`resources/views/pages/dashboard/index.edge` renders todo statistics. The Overview screen is
entirely the demo domain's numbers, so this is the one screen you have to rebuild rather than
delete — or point the route at your own controller.

---

## Step 3 — remove the vocabulary

These compile without the domain, but leave `lists` and `todos` in core forever if you skip them.

**`config/plans.ts`** — drop `lists` and `todosPerList` from `PlanLimits` and from all three plan
tiers, and add whatever your product actually meters. Everything downstream follows from this one
file: `LIMIT_KEYS` is derived from it, so the staff override form in
`resources/views/pages/admin/organizations/show.edge` re-populates itself, and the server-side check
in `AdminOrganizationController.overrideLimits` reads the same object.

**`app/api/scopes.ts`** — replace the `lists:*` and `todos:*` entries in `API_SCOPES`,
`DEFAULT_SCOPES` and `SCOPE_DESCRIPTIONS` with your own. `database/schema_rules.ts` references the
`ApiScope` type rather than restating the union, so `database/schema.ts` regenerates correctly with
no edit. `members:read` is core.

**`app/exceptions/plan_limit_exceeded_exception.ts`** — the `nouns` map turns a limit key into
something a customer can read. Drop `lists` and `todosPerList`, add yours. A key with no entry falls
back to the key itself, so a miss is ugly rather than broken.

**`app/models/public_id.ts`** — remove the `todoList: 'lst'` and `todo: 'tdo'` prefixes and add your
own. Adding a prefix here is what makes `tests/unit/public_id.spec.ts`'s exhaustive pass cover your
resource too.

**`database/schema_rules.ts`** — remove the `todo_lists` and `todos` table rules (the `color` and
`priority` unions).

**`app/api/openapi.ts`** — remove `listSchema`, `todoSchema`, the `/lists` and `/todos` path
entries, and the sentence in `info.description` that names `POST /lists`.

**`app/validators/api.ts`** — remove the four `apiCreateList` / `apiUpdateList` / `apiCreateTodo` /
`apiUpdateTodo` validators. `createApiKeyValidator` is core.

**`app/transformers/organization_transformer.ts`** — remove `usage.lists` and `usage.todos_per_list`
from the payload.

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
| `tests/functional/admin/back_office.spec.ts`, `tests/functional/api/auth.spec.ts`, `tests/functional/billing/webhooks.spec.ts` | incidental — they create a list to have a row to act on |

`tests/helpers.ts` exports `createList()` for these. Replace it with a factory for your own
resource and most of the suites follow.

{: .note }
The isolation suite is the one to port rather than rewrite. It is the reason the tenancy claims in
these docs are true, and a new domain with no equivalent is the single easiest way to undo the
value of this starter.

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
