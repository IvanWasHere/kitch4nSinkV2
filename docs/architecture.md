---
title: Architecture
nav_order: 2
---

# Architecture

How a request travels, where the code lives, and the handful of rules that keep two database engines
telling the same story.

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

---

## Where things live

| Directory | What's in it |
|---|---|
| `app/auth`, `app/organizations` | Registration, tokens, two-factor, invitations, membership |
| `app/todos`, `app/storage`, `app/api` | The product: lists, todos, files, public API |
| `app/billing` | Plans, provider, webhook handling, reconciliation |
| `app/support`, `app/notifications`, `app/audit` | Tickets, announcements, the audit trail |
| `app/admin` | Staff-side services and policies |
| `app/queue` | The queue service, job registry and the jobs themselves |
| `app/controllers`, `app/middleware`, `app/policies`, `app/validators`, `app/transformers` | The usual cross-cutting layers |
| `config`, `start`, `database`, `commands`, `tests` | Configuration, routes and kernel, migrations, ace commands, suites |
| `resources` | Edge templates, CSS tokens and components, Alpine components |

Imports use Node subpath aliases rather than relative paths: `#todos/list_service`,
`#models/todo`, `#billing/plan_service`. Routes reference controllers through a generated index, so
a renamed controller fails at build rather than at runtime.

---

## Two Bouncers

There are two authorisation instances, not one: `bouncer` for customers and `staffBouncer` for
staff. They exist separately because a policy is typed against its subject, and one instance cannot
be typed against both a customer and a staff member without collapsing the generated list of
actions. That is also why staff policies live under `app/admin` rather than `app/policies`.

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
- **No dialect-specific SQL**, no `ILIKE`, and no raw SQL outside the one place the queue needs it.
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
**prefixed public id** — `org_`, `usr_`, `lst_`, `tdo_`, `tkt_`, `key_`, `fil_` — generated from an
alphabet with the ambiguous characters removed. An id with the wrong prefix fails to parse and
becomes a 404 without ever reaching the database.

### Soft deletes

Deleting stamps a timestamp. The scope that hides deleted rows is applied explicitly rather than
globally, so staff screens can still see what a customer deleted, and nothing disappears from an
audit trail because of a default.

---

## Background work

A database-backed queue — no Redis, one datastore. Jobs are registered by name in an explicit map,
so a job that no longer exists fails loudly instead of silently never running.

- A worker reserves a job by **compare-and-swap on a reservation column**, which needs no
  dialect-specific locking SQL at all.
- Delivery is **at-least-once**, so every handler has to be idempotent.
- Failures back off exponentially, up to five attempts, then land in the back office as a failed
  job.
- A reserved job whose worker died is reclaimed after a visibility timeout.
- There are two queues by convention, `default` and `mail`, so a nightly sweep can never delay a
  password-reset email.

Recurring work is dispatched by `node ace schedule:run`, driven by system cron. Cron only *queues*
the work; the queue runs it, which means overlap and retries are handled in one place.

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

The content security policy is strict: scripts run from the site itself plus a per-response nonce.
Webhook and API routes are exempt from CSRF by URL prefix, because they authenticate by signature and
bearer token instead.
