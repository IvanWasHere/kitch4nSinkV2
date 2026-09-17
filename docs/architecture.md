---
title: Architecture
nav_order: 2
---

# Architecture

How a request travels, where the code lives, how a feature plugs in, and the handful of rules that
keep two database engines telling the same story.

---

## The layers

```
Request
  │
  ├─ server middleware      security headers, static files, Vite
  ├─ router middleware      bodyparser, session, shield (CSP/CSRF), auth, bouncer, impersonation
  ├─ route group middleware auth → verified email → organization → owner
  │                         or: staff IP allowlist → staff auth
  │                         or: track usage → API key auth → rate limit
  ▼
Controller        validates input, authorises, redirects or renders
  │
Service           the actual behaviour, and the only place that writes
  │
Model             a generated schema class plus mixins
  │
Database          SQLite or Postgres
```

Controllers stay thin on purpose. A controller resolves a record through a service, authorises it
through a policy, validates input with a VineJS validator, and hands off. The service is where the
transactions, the limit checks and the domain rules live — which is why "check the service, not the
controller" is usually the fastest way to answer a question about behaviour.

API responses go through **transformers** instead of serialising models directly, so the JSON
contract is written down in one place rather than emerging from whatever columns happen to exist.

A feature module sits in exactly these layers; it does not get a private architecture.

---

## Where things live

| Directory | What's in it |
|---|---|
| `app/auth`, `app/organizations` | Registration, tokens, two-factor, invitations, membership |
| `app/billing` | Plans, the quota registry, provider, webhook handling, reconciliation |
| `app/storage`, `app/api` | Files, and the public API's keys, scopes, cursors and OpenAPI document |
| `app/support`, `app/notifications`, `app/audit` | Tickets, announcements, the audit trail |
| `app/queue` | The queue service, the job registry, and core's own jobs |
| `app/dashboard`, `app/seeding` | The Overview screen's widget registry, and the demo dataset's |
| `app/admin` | Staff-side services and policies |
| `app/models`, `app/policies`, `app/validators`, `app/transformers`, `app/middleware`, `app/controllers`, `app/exceptions`, `app/mail` | The cross-cutting layers, for core's own subjects |
| **`app/modules/lists`** | **The demo domain** — a feature module, and the shape yours takes |
| `config`, `start`, `database`, `commands`, `tests` | Configuration, registries and routes, migrations, ace commands, suites |
| `resources` | Edge templates, CSS tokens and components, Alpine components |

Imports use Node subpath aliases rather than relative paths: `#billing/plan_service`,
`#models/organization`, `#modules/lists/services/list_service`. Routes reference controllers through
a generated index, so a renamed controller fails at build rather than at runtime.

---

## Feature modules

The demo domain — shared to-do lists — is not wired into the application; it **registers** itself.
That is the difference between a starter you can adapt and one you have to unpick, and it is
described end to end in [replacing the demo domain](modules.md).

A module is one folder holding its own models, services, controllers, policies, transformers, jobs,
mails, validators, routes, API surface, schema rules, demo seeder and tests, imported as
`#modules/<name>/…`.

### Core never imports a module

Everything a module contributes goes through a registry, each filled by exactly one file under
`start/`:

| Registry | Filled by | What it decides |
|---|---|---|
| `app/billing/quotas.ts` | `start/quotas.ts` | which limits exist, how to count them, what the meters show |
| `app/dashboard/widgets.ts` | `start/dashboard.ts` | what the Overview screen shows |
| `app/api/scopes.ts` | `start/api.ts` | what an API key may be granted |
| `app/api/openapi.ts` | `start/api.ts` | what the published spec describes |
| `app/queue/registry.ts` | `start/jobs.ts` | which jobs the worker runs, and which cron tick dispatches them |
| `app/seeding/demo_seeders.ts` | `start/seeders.ts` | what `dev:seed` puts in the demo workspaces |
| — | `start/routes/web.ts`, `start/routes/api.ts` | a module exports route functions; core calls them **inside** its own groups, so they inherit the same middleware stack |
| — | `config/database.ts` | a module's schema-rules path, merged into the generated schema types |

Each registry owns a mechanism and knows nothing about the subject. `PlanService` owns the
arithmetic — the amber-at-80% rule, the `>=` that makes a downgraded workspace read as full, the row
lock inside a create — and does not know what is being counted. The Overview screen holds no
queries. The OpenAPI document merges contributed paths into core's.

This is enforced, not merely intended: **`tests/unit/modularity.spec.ts`** asserts that nothing
outside those registration points imports `#modules/…`, and that every registration point still
registers something. A careless import in a core service fails the suite.

### The generated indexes

`indexEntities` and `indexPolicies` in `adonisrc.ts` scan `app/` rather than `app/controllers` and
`app/policies`, so a module's controllers and policies land in the generated barrels beside core's —
`controllers.lists.List`, `controllers.lists.api.List`. Three details there are load-bearing and
explained in a comment beside them; the one worth knowing is that the policy glob names `policies`
as a *directory*, which is what keeps `app/admin/staff_policy.ts` out of the tenant registry.

Because a policy's generated key follows its path, a module's policies are keyed
`ModulesListsTodoPolicy` rather than `TodoPolicy`. Verbose, but generated and completed by the
editor.

### What stays outside a module

Two things, each for a reason worth knowing before trying to move them:

- **Edge templates** live in `resources/views/pages/<name>/`. Edge resolves from a single root, and
  a second one would mean renaming every `view.render` call for no real gain.
- **Migrations** live in `database/migrations/`. Lucid records a migration by its *path*, so
  relocating a file makes it look like a new migration and re-runs it against a database that
  already has the table — while the test suite, which always migrates from scratch, stays green.

---

## Two Bouncers

There are two authorisation instances, not one: `bouncer` for customers and `staffBouncer` for
staff. They exist separately because a policy is typed against its subject, and one instance cannot
be typed against both a customer and a staff member without collapsing the generated list of
actions. That is also why staff policies live under `app/admin` rather than in any `policies`
directory — and why the policy index deliberately cannot see them.

Policies always take the actor explicitly instead of reading the current session, so the same rules
apply to an API key acting for a workspace, or a staff member impersonating a customer.

---

## Two database engines

SQLite locally, Postgres in production, from the same migrations. CI runs the entire suite against
both, which is what actually keeps this true. The rules that make it work:

- **Only `increments()` for primary keys**, and a separate public id for anything that appears in a
  URL.
- **Timestamps are `timestamptz`, always written in UTC by the application**, never by a database
  default.
- **No column alters.** Add, backfill, drop — across three migrations.
- **No dialect-specific SQL and no raw SQL.** Not even in the queue, which was the one place
  budgeted for it; the only `rawQuery` in the codebase is the `select 1` the health check uses to
  prove the connection is alive.
- **Money is integer minor units.** Cents, never floats.
- **JSON goes through a column decorator**, so it round-trips identically on both engines.

Two traps follow from this, and they show up all over the codebase as deliberate choices:

1. **Do not compare timestamps in SQL.** A timestamp column compared against a bound value means
   different things on each engine, which is why "overdue", "completed this week" and the monthly
   growth buckets are all filtered in application code.
2. **Do not compare two datetimes as ISO strings.** The offset is formatted differently. Compare
   milliseconds.

There is a third, quieter one: row locking is a no-op on SQLite. Concurrency bugs therefore only
surface on the Postgres leg of CI, never on a laptop.

### Identifiers

Internal ids are integers and never leave the server. Everything on a URL or in an API response is a
**prefixed public id** — `org_`, `usr_`, `tkt_`, `key_`, `fil_`, and `lst_` and `tdo_` from the demo
module — generated from an alphabet with the ambiguous characters removed. An id with the wrong
prefix fails to parse and becomes a 404 without ever reaching the database.

The prefix registry in `app/models/public_id.ts` is a plain constant rather than something a module
registers into, and that is deliberate: `withPublicId()` runs when a model class is *defined*, so a
prefix arriving from a preload could be missing at exactly the wrong moment and mint an
`undefined_…` id. A constant is complete before any model loads, which is also what makes an
exhaustive test over every prefix possible.

### Soft deletes

Deleting stamps a timestamp. The scope that hides deleted rows is applied explicitly rather than
globally, so staff screens can still see what a customer deleted, and nothing disappears from an
audit trail because of a default.

---

## Background work

A database-backed queue — no Redis, one datastore. Handlers are registered by name in
`start/jobs.ts`, so a job whose handler no longer exists fails loudly as an unknown job instead of
silently never running. A test reads `app/queue/jobs/` and every module's `jobs/` from disk and
asserts each handler there is registered, because "silently stopped being registered" is the one
failure a registry cannot report on itself.

- A worker reserves a job by **compare-and-swap on a reservation column**, which needs no
  dialect-specific locking SQL at all — and no raw SQL either.
- Delivery is **at-least-once**, so every handler has to be idempotent.
- Failures back off exponentially, up to five attempts, then land in the back office as a failed
  job.
- A reserved job whose worker died is reclaimed after a visibility timeout.
- There are two queues by convention, `default` and `mail`, so a nightly sweep can never delay a
  password-reset email.

Recurring work is dispatched by `node ace schedule:run`, driven by system cron. The command asks the
registry what is due on the interval it was given, so a job added or removed with a feature is
dispatched — or not — without editing the command. Cron only *queues* the work; the queue runs it,
which means overlap and retries are handled in one place.

---

## Mail

Everything goes through one service, which renders the message **at dispatch time** and queues it.
Rendering early means the email says what was true when the action happened, and a row deleted five
minutes later cannot break delivery. Each message carries a stable idempotency key across retries.

Locally, mail goes to [Mailpit](https://mailpit.axllent.org) on port 1025 and you read it at
`http://localhost:8025`. There is no in-app preview route. In production it goes to Resend.

---

## The front end

Server-rendered Edge templates with Alpine.js for interaction, built by Vite.

- **Every interaction works without JavaScript.** Menus are `<details>` elements; Alpine adds
  close-on-outside-click, not the menu itself. Alpine removes round trips; it is never the feature.
- **No hardcoded colours.** Every value comes from a token in `resources/css/tokens.css`, with role
  tokens preferred over raw ramp steps.
- **Fonts are self-hosted** through `@fontsource` packages, never a CDN — the content security
  policy would block one anyway.
- **Charts are divs**, not a library.

Shared screens name no feature. The usage meters and the at-cap banner iterate the quota registry,
the pricing grid iterates the limit catalogue in `config/plans.ts`, and every nav item is guarded by
`hasRoute` — so a destination appears the moment its routes are registered and is absent when they
are not.

The content security policy is strict: scripts run from the site itself plus a per-response nonce.
Webhook and API routes are exempt from CSRF by URL prefix, because they authenticate by signature and
bearer token instead.
