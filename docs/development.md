---
title: Development
nav_order: 12
---

# Development

Running the application, filling it with something worth looking at, and the traps that have already
caught somebody.

---

## Running it

```bash
npm install
cp .env.example .env          # then set APP_KEY
node ace migration:fresh --force
node ace db:seed              # test accounts
node ace dev:seed             # the demo dataset
npm run dev
```

SQLite by default, so there is no database to install. Mail needs [Mailpit](https://mailpit.axllent.org)
on port 1025 — `docker run -p 1025:1025 -p 8025:8025 axllent/mailpit` — and you read what was sent at
`http://localhost:8025`. There is no in-app mail preview.

Background work needs a worker, in its own terminal:

```bash
node ace queue:work
```

---

## The demo dataset

`node ace dev:seed` builds five workspaces across every plan and state: a team with a pending
invitation, lists and todos in every state a todo has, API keys with two weeks of traffic behind
them, uploaded files, published announcements, support tickets in all three states, a workspace past
due and one that cancelled, plus a failed job and a webhook that never applied.

Every screenshot on this site comes from it. If a screen looks empty here, it will look empty for
whoever clones the repository.

It wants a **fresh** database — it registers its first account immediately, so a second run stops on
the unique index rather than half-seeding:

```bash
node ace migration:fresh --force && node ace db:seed && node ace dev:seed
```

It prints the invitation link on the way past. Only the hash of the token is stored, so that print is
the only chance to see it.

### Signing in

| Account | Password | Where |
|---|---|---|
| `jane@example.com` | `correct-horse-battery` | Owner of a free workspace |
| `sam@example.com` | `correct-horse-battery` | Member of it |
| `owner-pro@example.com` | `correct-horse-battery` | Owner on Pro, two-factor on |
| `owner-northwind@example.com` | `correct-horse-battery` | Past due, dunning banner |
| `admin@example.com` | `Admin12345` | `/admin/login`, staff admin |
| `support@example.com` | `Support12345` | `/admin/login`, staff support |

For two-factor, `DEV_TWO_FACTOR_CODE=123456` is accepted in development, or
`node ace dev:totp admin@example.com` prints a real one.

---

## Commands

| Command | What it does |
|---|---|
| `node ace queue:work` | Run the worker |
| `node ace queue:retry --id=N` / `--all` | Re-queue failed jobs |
| `node ace schedule:run --interval=daily` | Dispatch the recurring jobs, from cron |
| `node ace billing:sync [--dry-run]` | Compare subscriptions against the provider |
| `node ace billing:replay <id>` / `--failed` | Re-apply a stored webhook, with no network call |
| `node ace staff:create` | Create a back-office account (the only way) |
| `node ace dev:totp <email>` | Print a valid two-factor code |
| `node ace dev:seed` | Build the demo dataset |

---

## Tests

```bash
npm test                  # everything
npm run lint
npm run typecheck
```

Three suites: unit, functional (by far the largest, organised by area) and browser, which drives
Chromium through Playwright.

CI runs lint and typecheck, then **the whole suite twice — once on SQLite and once on Postgres 17**.
That second run is what actually enforces the portability rules, and it is the only place some
concurrency bugs can appear at all, because row locking does nothing on SQLite.

---

## Traps already hit

Collected here because each one cost somebody an afternoon.

**Never compare a timestamp column in a SQL `WHERE`.** The comparison means different things on
SQLite and Postgres. Filter in application code — which is why "overdue", "completed this week" and
the growth buckets all do.

**Never compare two datetimes by their ISO strings.** The offset is formatted differently on the two
engines. Compare milliseconds.

**A nullable column you never assigned is `undefined`, not `null`,** on a freshly created model. So
is a column with a database default — if a counter needs to start at zero, set it explicitly.

**Row locking is a no-op on SQLite.** A concurrency test that passes locally may still fail on the
Postgres leg of CI. That is the leg to believe.

**Counters move inside the transaction that moves the rows.** Storage bytes and todo counts are never
updated as a follow-up write. The nightly jobs only *report* drift; they never quietly repair it.

**`node ace configure @adonisjs/mail` overwrites the from-address** in `.env` with a placeholder.
Check it after any `configure` run.

**An Edge component tag must be first on its line**, or it prints as literal text. Tag names are the
camelCase of the filename.

---

## Conventions

- Services hold the behaviour and own the transactions; controllers validate, authorise and
  redirect.
- Policies take the actor explicitly, never reading it from the session, so the same rules cover API
  keys and impersonation.
- Money is integer minor units everywhere, formatted only in a view helper.
- Anything on a URL is a prefixed public id; integer ids never leave the server.
- Every queue handler must be idempotent — delivery is at-least-once.
- Every interaction must work with JavaScript switched off. Alpine removes round trips; it is never
  the feature itself.
