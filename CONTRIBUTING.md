# Contributing

The implementation plan lives in [`plan.md`](./plan.md). It is the source of truth for scope,
decisions, and build order — read the relevant section before starting a milestone.

## Running the app

```bash
npm install
node ace generate:key        # only if .env has no APP_KEY
node ace migration:run
npm run dev                  # http://localhost:3333
```

SQLite is the default and needs no setup. To run against Postgres locally, set
`DB_CONNECTION=postgres` plus either `DATABASE_URL` or the discrete `DB_*` variables.

```bash
npm run lint
npm run typecheck
npm test
```

## Database portability rules (plan §5.1)

The app runs on SQLite locally and Postgres when deployed, on **identical application code**.
There are no `if (isSqlite)` branches outside the one sanctioned exception below. Portability is
enforced at the migration layer, and these rules are checked in review.

1. **Primary keys** — `table.increments()` / `table.bigIncrements()`. Never hand-write Postgres
   `serial` / `identity` DDL.
2. **JSON columns** — `table.json()`. Lucid stores TEXT on SQLite and `json` on Postgres, so always
   round-trip through a model `prepare` / `consume` pair to get identical behaviour on both.
3. **Timestamps** — `table.timestamp(name, { useTz: true })` everywhere. Store UTC. Never rely on a
   database `now()` default; the application supplies the value.
4. **No column alters.** SQLite's `ALTER TABLE` is severely limited. To change a column: add a new
   column, backfill it in a migration, then drop the old one — three migrations, not one alter.
5. **No dialect-specific types or operators**: no `citext`, `enum`, `array`, `jsonb` operators,
   partial indexes, or `ILIKE`. Case-insensitive email is achieved by lowercasing at the model
   layer plus a plain unique index.
6. **No raw SQL in application code.** The single sanctioned exception is the queue reservation
   query (plan §9), which is dialect-switched in exactly one place inside `QueueService`.
7. **Booleans** via `table.boolean()`, always read back through Lucid — SQLite hands back 0/1 and
   Lucid normalises it.
8. **Money** as integer minor units (`amount_cents`). Never float, never decimal.

CI runs the full suite against **both** engines on every push. A rule that is only exercised on
SQLite is not enforced, so a migration that cannot run on Postgres fails the build.

## Tenancy rules

- Every tenant-owned table carries `organization_id` and an index on it.
- Every query against a tenant-owned table filters on `organization_id`. There is no endpoint that
  accepts an organisation id as a parameter — the session or the API key *is* the scope.
- Tenancy belongs in the **lookup**, not in a check after it. `where('public_id', id)
  .where('organization_id', …)` makes a foreign id behave exactly like a missing one; fetching by
  id and then comparing leaks the fact that the row exists.
- Authorisation is a Bouncer policy, and **every policy takes the actor explicitly** rather than
  reading `auth.user`, so API-key actors and impersonating staff go through the same checks.
- **Every endpoint that takes an identifier gets a case in
  `tests/functional/tenant_isolation.spec.ts`.** That suite seeds two workspaces and asserts one can
  never read or mutate the other. A leak there is an incident, not a bug report.

## Two traps this codebase has already hit

1. **A nullable column that was never assigned is `undefined`, not `null`.** On a freshly created
   model `acceptedAt !== null` is `true`, so a brand-new invitation reports itself as accepted.
   Nullable-timestamp getters test truthiness instead.
2. **Do not compare a timestamp column against a bound value in SQL.** SQLite stores
   `YYYY-MM-DD HH:MM:SS` and compares it as text; Postgres compares it as a timestamp. Where a row
   count is small, decide it from the model's own getter instead — see `seatUsage`.

## Adding a table

1. Write the migration following the rules above. Migration order matters — see plan §5.3.
2. Run `node ace migration:run`. This regenerates `database/schema.ts`; **do not edit that file**.
   To change how a column is typed or decorated, edit `database/schema_rules.ts` instead.
3. Create the model in `app/models/`, composing the generated schema class with the mixins it
   needs, e.g. `compose(TodoListSchema, withPublicId('todoList'))`.
4. If the table carries a `public_id`, register its prefix in `app/models/public_id.ts`.

## Local email

Transactional email goes to [Mailpit](https://mailpit.axllent.org) in development — nothing leaves
your machine:

```bash
brew install mailpit && mailpit          # or: docker run -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Then open http://localhost:8025. With Mailpit not running, sends fail and are logged rather than
raised, so signup still works; the "send another link" action is the recovery path.

## Staff accounts

Staff cannot self-register. Create the first one from a shell:

```bash
node ace staff:create --email=you@example.com --role=admin
```

It prompts for a password and walks through two-factor enrolment, which is mandatory for staff.
Pass `--password=…` for non-interactive setup (a container's release phase), in which case
enrolment is completed without asking for a code and the recovery codes are printed.

### Two-factor while developing

`.env` ships with `DEV_TWO_FACTOR_CODE=123456`, and **`123456` is accepted anywhere a six-digit
authenticator code is asked for** — the sign-in challenge and enrolment alike. That is an
authentication bypass, so it has two independent gates and both must hold:

1. `NODE_ENV` is exactly `development`. Production is excluded, and so is the test suite — the
   two-factor tests still exercise real TOTP, and one of them asserts `123456` is refused there
   even with the variable set.
2. `DEV_TWO_FACTOR_CODE` is set. It lives in `.env`, which is not deployed.

Every use logs a warning, so an environment where this is unexpectedly live says so out loud
instead of silently accepting `123456` forever. Unset the variable and two-factor behaves normally.

`node ace dev:totp <email>` prints a genuine code for an account, for when you want to exercise the
real path. It refuses to run outside development.

## Test accounts

```bash
node ace migration:fresh --seed
```

Four addresses, each used exactly once. Two are employees of the SaaS, two are customers in one
workspace.

| Account | Password | Signs in at | Role |
|---|---|---|---|
| `admin@example.com` | `Admin12345` | `/admin/login` | Staff — admin |
| `support@example.com` | `Support12345` | `/admin/login` | Staff — support |
| `user-manager@example.com` | `Manager12345` | `/login` | Owner of "Example Workspace" |
| `user@example.com` | `User12345` | `/login` | Member of the same workspace |

**Employees and customers are different tables behind different logins** (D5). A staff address is
rejected at `/login` exactly as a stranger would be, and vice versa — the two guards do not know
about each other, which is the point. An address is never both: `staff:create` refuses one that
already belongs to a customer.

Staff two-factor is mandatory and is not relaxed for the seeded accounts, so `/admin/login` asks
for a code — enter **`123456`** in development (see "Two-factor while developing" above), or run
`node ace dev:totp admin@example.com` for a genuine one.

The manager is the workspace **owner**: billing, inviting and removing people are exactly what §6
grants an owner, and there is one owner per organisation (D1). Signed in as the member, the invite
and remove buttons are absent and the workspace settings form is read-only. Billing screens land in
M4; until then the nav item does not exist for anyone.

These are a **seeder**, not a migration. Migrations run everywhere, including a production release
phase, so accounts with published passwords created from one would land on the live database — and
deleting the migration later would not remove rows it had already created. Seeders declare
`static environment` and are skipped entirely outside development and test. Re-running is safe:
existing accounts are left alone.

## Demo data

```bash
node ace dev:seed
```

Creates one workspace with an owner, a member and a pending invitation, and prints the invitation
link — only the hash of an invitation token is stored, so that print is the one chance to see it.
Development only. Seeders covering every plan tier arrive in M8.

## Frontend

`example-ui/index.html` is the **visual reference**, not code to port. It is a Mithril prototype
with fixture data; its CSS is what transfers, and it has been extracted into `resources/css/`.
Screens are Edge templates with Alpine.js for interactivity (plan §13).

- Nothing hardcodes a colour. Every value comes from a token in `resources/css/tokens.css`.
- Every interaction works as a plain form POST with JavaScript disabled; Alpine only removes
  round trips.
- Tabs are real URLs, so they can be linked, bookmarked, and permission-gated server-side.
- `/styleguide` (development only) renders the whole component library on one page. Add new
  components there so they can be reviewed in isolation.

### Two Edge rules that fail silently

Both of these produce a page that renders *without an error* but with the tag printed as literal
text, so they are worth knowing before you lose ten minutes to one:

1. **A component tag must be the first thing on its line.** `<span>@!icon({ name: 'x' })</span>`
   is emitted as text; put the tag on its own line.
2. **Tag names are the camelCase of the file name.** `components/stat_card.edge` is called as
   `@!statCard(...)`, not `@!stat_card(...)`. Nested files keep the dot form —
   `components/field/root.edge` is `@field.root(...)`.
