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
7. **Booleans** via `table.boolean()`, and declared as `boolean` in `database/schema_rules.ts` so
   the generated column carries `booleanColumn()`. Lucid does **not** normalise these for you:
   SQLite hands back `0`/`1` and Postgres real booleans, so without the cast `row.flag === true`
   fails on one engine while `if (row.flag)` quietly agrees on both.
8. **Money** as integer minor units (`amount_cents`). Never float, never decimal.

CI runs the full suite against **both** engines on every push. A rule that is only exercised on
SQLite is not enforced, so a migration that cannot run on Postgres fails the build.

## The domain: lists and todos

Lists belong to the **organisation**, not to whoever created one (D8). Every member sees every
list; `createdByUserId` is provenance for the UI and must never appear in an access check.

- **Completion is a timestamp**, not a boolean — which is where "completed this week" comes from.
  Un-ticking clears the timestamp and the "completed by" together.
- **Archive vs delete.** Archiving hides a list, is reversible, and is open to any member; the list
  keeps its seat against the `lists` quota so archiving cannot dodge the cap. Deleting is
  owner-only, takes every todo with it, and is soft.
- **`todo_lists.todos_count` is denormalised** and only ever moved inside the same transaction as
  the insert or delete it accounts for — never as a follow-up write. Completed todos still count;
  soft-deleted ones do not. `ReconcileCountersJob` recomputes nightly and **alerts** on drift: the
  counter cannot drift without a bug, and a job that quietly repairs one hides it forever.
- **Positions are sparse** (100 apart), so a drag is one write. When two neighbours become adjacent
  integers there is no room left, and `NormalizePositionsJob` spreads them out again.
- **`todos.organization_id` is denormalised** from its list, so every todo query can filter on it
  without a join. The composite foreign key `(todo_list_id, organization_id)` is what stops the copy
  from disagreeing with the list — without it the denormalisation would be a way to hide a row from
  its own tenant filter.
- **Due dates are stored UTC** and rendered in `organizations.timezone`. A date typed into the form
  means end of that day *where the workspace is*, not midnight UTC.

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

## Traps this codebase has already hit

1. **A nullable column that was never assigned is `undefined`, not `null`.** On a freshly created
   model `acceptedAt !== null` is `true`, so a brand-new invitation reports itself as accepted.
   Nullable-timestamp getters test truthiness instead.
2. **Do not compare a timestamp column against a bound value in SQL.** SQLite stores
   `YYYY-MM-DD HH:MM:SS` and compares it as text; Postgres compares it as a timestamp. Where a row
   count is small, decide it from the model's own getter instead — see `seatUsage`.
3. **Do not compare two `DateTime`s by `toISO()`.** One read back from the database carries a zone
   offset (`…+00:00`) and one parsed from an API payload carries `Z`, so the same instant compares
   unequal. Use `toMillis()`, and render `toUTC().toISO()` only for humans — see
   `ReconciliationService`, where this bug would have reported drift on every subscription every
   night for ever.
4. **A row lock that is a no-op on SQLite still has to be there.** `forUpdate()` does nothing on
   SQLite, which is correct — better-sqlite3 serialises writes anyway — so a *missing* lock also
   passes the whole suite on SQLite and lets two parallel requests both take the last slot on
   Postgres. Concurrency tests only mean something on the Postgres leg of the matrix.
5. **A redirect to somebody else's URL needs `.clearQs()`.** `config/app.ts` sets
   `forwardQueryString: true`, which is right for a redirect back to one of our own screens and
   wrong for one that leaves the application: the forwarded parameters are appended *after* that
   URL's own query string, so `…&signature=…?download=1` is no longer the string that was signed
   and the download 401s. Every outbound redirect — signed storage URLs, provider checkout and
   portal links — calls `.clearQs()` first.
6. **A column with a database default is `undefined` on the model that just created it.** Nothing
   assigned it, so `organization.storageUsedBytes + size` on a freshly registered workspace is
   `NaN`, and a quota compared against `NaN` refuses everything. Counters get a `@beforeCreate`
   hook that initialises them — see `Organization`.
7. **A rate-limit window longer than ~24.8 days is silently broken on the memory store.** It expires
   records with `setTimeout`, and Node fires a timeout past `2^31` ms immediately — so the counter
   resets on *every* request, looking exactly like an unlimited plan. The database store has no such
   limit. `ApiRateLimitMiddleware` clamps every window below the ceiling.
8. **`config/shield.ts` CSRF-exempts by URL prefix, and the API needs it.** A bearer-authenticated
   client has no session, no cookie and no way to obtain a CSRF token — without the exemption every
   `POST /api/…` is a 403 that looks like an authorisation bug.
9. **`convertEmptyStringsToNull` means an empty form field arrives as `null`.** `String(null)` is
   the string `"null"` — neither empty nor a number — so "clear this value" silently did nothing
   until the null was handled before stringifying. Read the raw input first.
10. **Bouncer refuses an HTML POST with a redirect, and a GET with a 403.** A test asserting 403 on
   a denied POST fails even though the refusal worked; assert the redirect *and* that nothing
   changed.
11. **Edge's `@let` takes a single line, and does not scope reliably inside a nested block.** A
   multi-line expression, or a `@let` inside an `@if` inside a component slot, fails at *render*
   with "x is not defined" — not at parse. Derive the value in a controller or middleware and share
   it instead; a shell with no logic of its own cannot get it wrong on one screen and right on
   another.

## Adding a table

1. Write the migration following the rules above. Migration order matters — see plan §5.3.
2. Run `node ace migration:run`. This regenerates `database/schema.ts`; **do not edit that file**.
   To change how a column is typed or decorated, edit `database/schema_rules.ts` instead.
3. Create the model in `app/models/`, composing the generated schema class with the mixins it
   needs, e.g. `compose(TodoListSchema, withPublicId('todoList'))`.
4. If the table carries a `public_id`, register its prefix in `app/models/public_id.ts`.

## Background jobs

Since M3 the application never does slow work inside a request. `queue:work` is a second process:

```bash
npm run dev                    # web
node ace queue:work            # worker — nothing is delivered without it
```

- `node ace queue:work --once` drains what is due and exits, which is what you want while testing.
- `node ace queue:retry --all` re-queues failures from a shell; the admin panel's Job queue screen
  does the same with a button.
- `node ace schedule:run --interval=daily` dispatches the recurring jobs. System cron calls this —
  cron's only job is to *dispatch*, so a slow task cannot overlap its own next run and a failure
  retries with the queue's backoff instead of waiting a whole day.

**Every handler must be idempotent.** Delivery is at-least-once: a worker that dies after doing
the work but before marking the job done will run it again when the reservation is reclaimed
(5 minutes). That is not a nicety — it is the only contract the queue can actually keep.

Handlers live in `app/queue/jobs/` and must be listed in `app/queue/registry.ts`. A job whose name
is not in the registry fails immediately rather than being retried five times, because no amount of
waiting will make the code exist.

Two queues, on purpose: `mail` carries sends, `default` carries scans that *produce* mail. Putting a
nightly sweep over every user on the same queue as the sends lets it sit in front of somebody's
password reset.

**A worker that renders email must commit the router first** (`queue:work` does). Routes are
committed by the HTTP server, which never starts in a command, so `urlFor` in a mail template
otherwise fails — quietly, because `MailerService` logs a render failure rather than crashing. A
job that sends in bulk should therefore check what `send()` returned and fail if anything did not
queue; `OverdueDigestJob` is the worked example.

## Billing and plan limits

Entitlements are a **pure function of `organizations.plan_key`** — no network call, no database
read — so `PlanService.can()` is free to call in a loop or in a template. `config/plans.ts` is the
whole catalogue: changing what a plan allows is a typed change with a diff and a test, never a
migration.

Two magic values, and the difference matters. `null` means **unlimited**; `0` means **not on this
plan at all**, so the feature's screen is hidden rather than shown empty.

### One source for usage

The nav counter (`Lists 3/3`), the meter on the dashboard, the disabled *New list* button, the
inline upsell, the `402` and the row-locked check inside the create transaction all read the same
`PlanService` numbers. **Never compute a usage figure a second way.** Two calculations of "how many
lists are you using" will eventually disagree, and the day they do a customer is either blocked
below their limit or billed for a plan they are exceeding.

`require_organization` shares `usage` with every rendered page, which is what the sidebar and the
`withinLimit()` Edge global read.

### Enforcing a count limit

Three limits are counts, and a plain `count() → compare → insert` is a race. Each is guarded in
exactly one place, **inside the transaction that does the insert, behind a row lock**:

| Limit | Where | Locks |
|---|---|---|
| `lists` | `ListService.create` | the `organizations` row, via `PlanService.lockAndAssertLimit` |
| `todosPerList` | `TodoService.create` | the `todo_lists` row (whose `todos_count` is the counter) |
| `seats` | `InvitationService.invite` and `.accept` | the `organizations` row |

`forUpdate()` is a real lock on Postgres and a no-op on SQLite, which is correct: better-sqlite3 is
synchronous and serialises writes at the connection, so the interleaving cannot occur there. **This
is why the concurrency tests must run on both engines** — a missing lock passes on SQLite and lets
two parallel requests both take the last slot on Postgres. That exact regression has already
happened here once.

`assertWithinLimit(org, limit, desired)` takes the count **after** the create, so callers pass
`current + 1`.

### Soft-lock: a downgrade never costs a customer anything

Over-limit organisations keep every row, **readable and editable**. Only creation is blocked. A
cancelled subscription sets `plan_key = 'free'` and does nothing else — no data job, no archiving,
nothing hidden — so a failed card costs a customer nothing and re-upgrading needs no restore job.
The next create attempt is what surfaces the new ceiling.

Two consequences the UI has to say out loud, because they otherwise read as bugs:

- **Archived lists still count.** Archiving hides a list; deleting one frees the slot.
- **Completed todos still count.** A fully ticked-off list at its cap is still full.

A blocked create is never a dead end. `PlanLimitExceededException` renders as `402
{ error: { code: 'plan_limit_exceeded', limit, allowed, current, upgradeUrl } }` for JSON and as a
flash plus the inline `.plan-card` upsell for HTML — the same numbers in both, from one place.

### Webhooks are the only source of truth

Entitlements move when the provider says money moved, and never one step earlier. `/billing/return`
is optimistic UI that grants nothing — a user can type that URL — so it polls `billing.status`
until the webhook has actually landed.

The endpoint does four things and stops (`WebhookController`):

1. Verify the HMAC over the **raw** body. Re-serialising parsed JSON reorders keys and changes the
   digest, so `request.raw()` is what gets signed — never `request.body()`.
2. Insert the `webhook_events` row. A unique violation means we have seen this event before, which
   is not an error: Creem retries five times. Answer 200 and stop.
3. Dispatch `ProcessWebhookJob` and answer 200 inside ~50ms. A provider that times out waiting for
   us retries, and a retry storm during a slow database is how billing state gets applied twice.
4. The worker applies it, where a failure backs off on our terms rather than the provider's.

`config/shield.ts` exempts `/webhooks/*` from CSRF through a **predicate**, not the array form —
the array is an exact match on `route.pattern`, so `'/webhooks/*'` there matches nothing and the
failure looks like a provider signing its requests wrong.

Three rules hold `WebhookHandler` together:

- **Idempotent.** Every write is an upsert keyed on the provider's own id.
- **Ordered by watermark, not arrival.** An event describing a state older than what the
  subscription row already knows is ignored, so a late `past_due` cannot undo the `active` that
  superseded it.
- **The provider is the truth.** On ambiguity, re-fetch rather than guess from the payload.

A tenant is resolved from the subscription we already recorded, or from the
`organizationPublicId` we put into the checkout metadata ourselves. **Nothing else** — never a
customer email, which is something the payer controls. An event that cannot be attributed is parked
for a human, not guessed at.

### Working on billing without a Creem account

`node ace dev:seed` creates one workspace per tier with a subscription and three charges behind it,
so every billing screen has content:

```
jane@example.com              free, at its 3-list cap
owner-pro@example.com         pro, with transaction history
owner-business@example.com    business, unlimited lists
```

For real deliveries, Creem test mode plus a tunnel (`cloudflared tunnel --url
http://localhost:3333`). Then:

```bash
node ace billing:replay 42        # re-apply one stored webhook, no network
node ace billing:replay --failed  # everything that never applied
node ace billing:sync --dry-run   # diff local subscriptions against the provider
```

`billing:replay` parses the stored payload through the provider exactly as the worker does, so a
replay proves something about the live path. It is safe to run twice.

`SyncBillingJob` runs the same reconciliation nightly. It **reports** every difference and corrects
only a status that disagrees — that one costs money in both directions. Everything else is logged
and left alone, for the same reason `ReconcileCountersJob` alerts rather than repairs.

### Adding a payment provider

One class in `app/billing/providers/` implementing `PaymentProvider`, plus an entry in
`config/payments.ts` and a case in `app/billing/provider.ts`. **Nothing outside
`app/billing/providers/` may import a provider SDK or speak a provider's wire format** — that rule
is what keeps the swap from becoming a rewrite. Map the provider's events onto the nine normalized
ones in `app/billing/contracts.ts`; an unmapped event must throw rather than be dropped, because a
silently ignored billing event is indistinguishable from one that never arrived.

Secrets declared with `Env.schema.secret()` come back as a `Secret` wrapper, not a string. Call
`.release()` before handing one to `createHmac` or a fetch header.

### Adding a mail provider

There is no interface to implement: `@adonisjs/mail` already is the abstraction, and
`config/mail.ts` is the whole seam. Add a transport to the `mailers` object, add its credentials to
`start/env.ts` as `Env.schema.secret.optional()`, and add the name to the `MAIL_MAILER` enum. No
application code changes, because nothing outside that file knows which mailer is active —
everything sends through `MailerService`.

Two things to know before you send anything real:

- **Delivery is queued, never inline** (§8). `MailerService.send()` renders the Edge templates,
  hands the compiled message to the queue, and returns. So a new transport is exercised by
  `SendMailJob`, and a provider outage becomes a retry rather than a failed signup. If your
  transport throws for a *permanent* reason — a rejected recipient, a disabled account — it will
  still be retried; there is no permanent-failure signal in the mail interface, and adding one is
  a change to `app/queue/jobs/send_mail_job.ts`, not to the transport.
- **The from-address is decided in one place.** `sendCompiled` sends exactly what it is given, so
  `MailerService` fills in the sender itself. A transport that overrides it will surprise you.

Locally, point `MAIL_MAILER=smtp` at Mailpit and read the mail in a browser rather than trusting a
provider's dashboard — see [Local email](#local-email).

### Adding a storage provider

Also config-only, and for the same reason: `config/drive.ts` chooses what backs a disk, and
application code only ever names a *purpose* — `private` or `public`. Add a service to the `disks`
object, add its variables to `start/env.ts`, and extend the `DRIVE_DISK` enum.

What a new backend has to provide, because `FileService` depends on all four:

1. **Signed URLs with an expiry.** Private files are handed to a browser as a short-lived signed
   URL rather than streamed through this application (§10). A backend without signing has to be
   fronted by a controller that streams, and that is a different design.
2. **`exists()` cheaply.** The readiness probe calls it on every check
   (`app/controllers/health_controller.ts`).
3. **A public URL builder**, if you want avatars and logos to be served straight from a CDN.
   Without one, the public disk has no `getUrl()` and those images break — which is why the R2
   service only installs a builder when `R2_PUBLIC_URL` is set.
4. **Keys exactly as given.** `buildObjectKey()` puts the tenant first
   (`orgs/{public_id}/{yyyy}/{mm}/{uuid}.{ext}`) and that prefix is what makes per-tenant policies,
   exports and deletions expressible. A backend that rewrites or normalises keys breaks all three.

Add the new origin to `img-src` in `config/shield.ts` at the same time — both the public domain and
the signing endpoint. Miss it and every avatar disappears with an explanation only in the browser
console.

## Files and storage

`config/drive.ts` chooses two things separately, and keeping them separate is the whole design:

- **Which disk** a file lives on is a *purpose* — `private` (everything, by default) or `public`
  (avatars and logos, served straight from a CDN). Application code names one of these two and
  nothing else.
- **What backs a disk** is an environment concern — the local filesystem on a laptop, Cloudflare R2
  when deployed, chosen by `DRIVE_DISK`.

So moving to R2 is one variable, and `files.disk` keeps recording which *purpose* a row belongs to
rather than which vendor held it.

**The database stores `disk` + `key`, never a URL.** That single rule is what makes a provider
migration a config change instead of a data migration. Reading a file means going through
`FileService`, which is where the signing policy lives; `File` deliberately has no `get url()`,
because one would be a URL cached in a template with a TTL nobody chose.

### Key convention

    orgs/{organization_public_id}/{yyyy}/{mm}/{uuid}.{ext}

**Tenant first**, which is the part that matters: a per-tenant bucket policy is expressible, "export
everything this customer has" is a prefix listing, and the purge job's orphan sweep is one call per
workspace. The filename is a uuid and **never** anything from the request — a client filename can
carry path traversal, a second extension, or somebody else's key (this is what v7's `move()` defaults
guard against, CVE-2026-21440). `original_name` is kept for display only.

### Upload order, and why it is that order

**Validate → move → write the row and the counter in one transaction.** Moving first would leave an
orphan object behind every rejected upload; writing the row first would let a failed move leave a
file the product believes it has. When the transaction refuses an upload that was already moved —
the over-quota race — `FileService` deletes the object it just wrote, and a failure to clean up is
logged rather than thrown, because the customer's error is the quota.

Everything about the request is a claim:

- the filename picks an extension from the allowlist and is then display-only;
- the reported size is **re-measured** while the checksum is computed;
- the content type is decided by **sniffing the first bytes** (`app/storage/mime.ts`), never from
  the request header. A `.png` that is really an HTML document is the classic stored-XSS upload and
  the extension alone cannot tell you.

A mismatch between bytes and extension is **refused, not corrected** — silently renaming a file to
match its content is how something executable ends up served as an image. SVG is deliberately not on
the allowlist: it is a document that can carry script.

`MAX_FILE_BYTES` (20 MB) must stay **below** the multipart limit in `config/bodyparser.ts` (25 MB),
which is the outer envelope for the whole request. The other way round, a file inside the cap would
be rejected by the parser before the application could say anything useful about it.

### Quota and deletion

`organizations.storage_used_bytes` moves inside the same transaction as the `files` row, behind a
lock on the organisation — the same rule `todos_count` follows. The comparison is in **bytes** and
the report is in **megabytes**: comparing rounded megabytes would let a 100 MB plan hold 100.9 MB.

Deletion is **soft**. The quota is released immediately — somebody who deleted a file to make room
should have that room now — while the object stays for 30 days, so deleting the wrong thing is
recoverable. `PurgeDeletedFilesJob` removes the object **first** and the row second, so a crash in
between leaves a row pointing at nothing (recoverable, and the next run finishes it) rather than an
object nothing points at.

The same job reports two kinds of drift and repairs neither: `storage_used_bytes` against the sum of
the rows, and objects in the bucket that no row claims. Both are bugs if they happen, and a job that
quietly fixes them nightly hides the bug for ever.

### Local development

Uploads land in `storage/` (gitignored). `DRIVE_FS_ROOT` moves that — the test suite points it at
`tmp/test-storage` so a suite run never scatters files through the working directory.

Private files are served locally by Drive's own route and **still require a signature there**, so
the local and deployed access rules are the same rules. A private file that is readable on a laptop
and not in production is a bug found by a customer.

## The organisation API

`/api/v1`, JSON only, versioned by URL segment. **The key is the scope**: no endpoint accepts an
organisation id, so there is nothing for a caller to pass and nothing to forge. Every query filters
on `ctx.organization.id`, which the key establishes.

### Keys

`sk_live_<32 chars>` / `sk_test_…`. We store the **prefix and a SHA-256 hash**, never the key — so
a leaked backup of `api_keys` grants nothing, and the secret exists for exactly one HTTP response.

SHA-256 unsalted and fast, deliberately. A key is 32 random characters, so there is no dictionary
to attack and nothing for a salt to defend; a slow hash would instead put its cost on **every
authenticated request**.

A key is **not a user**. It carries explicit scopes (`lists:read`, `lists:write`, `todos:read`,
`todos:write`, `members:read`) rather than inheriting the role of whoever created it — so promoting
that person does not silently widen what an integration can do, and removing them does not break
it. The web app's owner-only list deletion is mirrored as "needs `lists:write`".

Keys are owner-only (D4): one can spend the workspace's entire monthly allowance and be granted
write access to everything, which makes it billing-adjacent rather than a member-level setting.

### Middleware order

    trackApiUsage → apiKeyAuth → apiRateLimit

Tracking is **outermost** so a 401 or a 402 is recorded too — those are exactly the responses
somebody asks support about. For the same reason `ApiKeyAuthMiddleware` puts the organisation on
the context *before* the plan check: the key authenticated, so a 402 is attributable.

Entitlement is re-checked per request, not at key creation. A cancelled subscription closes the API
immediately without anybody having to revoke a key.

`last_used_at` is throttled to once a minute. It has to be maintained — it is what tells a customer
which key is safe to revoke — but a write per request would double the API's database traffic.

### Responses

One envelope: `{ data }` for an item, `{ data, meta }` for a page. Never a bare array — a top-level
array cannot grow a `meta` key later without breaking every client.

Responses are built by **transformers** with every field named explicitly, so adding a column to a
model can never widen the public contract, and an integer id never leaves the process. Keys are
snake_case on the wire; the translation happens in the transformer, once.

**Every timestamp goes out as `toUTC().toISO()`.** A DateTime read from the database renders as
`…+00:00` and one just created renders as `…Z`; an API emitting both for the same field breaks a
client comparing strings.

Errors are `{ error: { code, message, details? } }`. **`code` is the contract** — integrations
branch on it, so those strings are as permanent as a column name. The message is for a human and
may be reworded freely. `app/exceptions/handler.ts` decides JSON by **URL prefix**, not by the
`Accept` header, so a client that forgets the header still gets JSON rather than an HTML error page.

### Pagination

Cursor, not offset. Under concurrent writes offset pagination duplicates and skips rows without
ever erroring — a customer syncing tasks would silently miss records, which is the failure mode
that makes an integration untrustworthy. The cursor is an opaque base64 of the last row's id;
`limit + 1` rows are fetched so "is there a next page?" costs no second query, and `next_cursor:
null` is how a sync knows it is done. A malformed cursor starts from the beginning rather than
erroring, so a truncated query string cannot kill a sync loop.

### Rate limiting

Two rules, `limiter.multi()`, different jobs:

- **Burst**, keyed by API key — protects us. `x-ratelimit-limit` / `-remaining` / `-reset`.
- **Monthly quota**, keyed by *organisation* — enforces what the plan sold, so a second key does
  not double the allowance. `x-quota-limit` / `-remaining` / `-reset`.

Separate headers on purpose: one header that sometimes means "this minute" and sometimes "this
month" is worse than two that each mean one thing. Headers are set on **every** response, not just
a 429, because a client that only learns its budget by exceeding it cannot pace itself.

The calendar month lives in the **key** (`api:month:{org}:2026-09`), not in the duration —
`rate-limiter-flexible` windows slide from first consumption, which would drift away from the
invoice date.

`multi()` is not atomic: a request that trips the monthly rule has already spent a burst point.
That is fine — the request was refused anyway.

### 402 is a stop signal

`POST /lists` and `POST /lists/{id}/todos` return `402 plan_limit_exceeded` with the numbers and an
upgrade URL. This is the one genuinely unusual thing about the API, and it is documented
prominently in the OpenAPI description, because integrations treat a non-2xx as retryable by
default and retrying a quota block forever is the worst possible reading.

Bulk imports should call `GET /organization`, size the batch to `usage.*.remaining`, and treat a
mid-batch 402 as "stop and tell the customer".

### Usage

`api_requests` gets a row per call and is the trail support follows from an `x-request-id`. It grows
faster than anything else in the schema, so `RollupApiUsageJob` aggregates it nightly into
`api_usage_days` and prunes rows past 30 days — only once their day is rolled up, so pruning cannot
outrun the aggregate. The rollup **recomputes** rather than increments, because the queue is
at-least-once and an incrementing aggregate doubles on its second run.

### Documentation

`/docs` and `/openapi.json` are public — somebody deciding whether to build against this reads them
before they have a key. The document is hand-written in `app/api/openapi.ts` rather than generated
by reflection: a generated spec silently changes shape when somebody adds a column, which is the
exact failure the transformers exist to prevent. `tests/functional/api/endpoints.spec.ts` asserts
the document still describes the routes that exist.

## The back-office

Mounted at `/admin`, behind its own guard, its own table and its own login (D5). Two-factor is
mandatory for staff — the guard sends anyone without it to enrolment before any admin route runs.

### Support and admin

The split is not seniority, it is **blast radius**. Support can see everything and fix what a
customer is blocked on; admin is required for anything that moves money, removes access, or changes
what somebody is entitled to.

| | support | admin |
|---|---|---|
| Every screen except staff management | ✓ | ✓ |
| Resend verification, confirm an address, clear a lost second factor | ✓ | ✓ |
| Retry a job, replay a webhook, re-sync a subscription | ✓ | ✓ |
| Impersonate | read-only | writable |
| Override a plan or a limit | | ✓ |
| Cancel a subscription, suspend a workspace | | ✓ |
| Manage staff | | ✓ |

Replay and retry are support-level because both are **idempotent by construction** — the queue is
at-least-once and the webhook handler upserts on provider ids, so the worst case of replaying one is
that nothing changes.

The checks live in `StaffPolicy`, called from inside each controller rather than as middleware on
the route, so a support agent sees a screen **without its dangerous buttons** instead of a 403.

### Two Bouncers

`ctx.bouncer` is typed against the tenant `User`; `ctx.staffBouncer` against `StaffUser`. They are
separate because one Bouncer cannot be typed against both — registering a `StaffUser` policy on the
tenant map makes the whole map incompatible, at which point **every** tenant policy silently drops
out of the type-level action list and `bouncer.with('TodoPolicy')` stops compiling.

That is also why `StaffPolicy` lives in `app/admin/` rather than `app/policies/`: that directory is
scanned to build `#generated/policies`.

### Impersonation

The rules, and each exists because of a specific way this goes wrong:

- **Time-boxed to 60 minutes, absolutely.** Not a sliding window, which a polling page keeps open
  for ever.
- **The staff row is re-read every request.** Revoking access ends a session in flight rather than
  at the next sign-in.
- **`support` is read-only** — enforced by HTTP method, not by a list of routes, because a list is
  something somebody forgets to add to. The one exception is the route that *ends* the
  impersonation, which is itself a POST: without exempting it, support could start a session it
  could not leave.
- **The banner renders on every tenant screen** with the button that ends it. An impersonation gets
  forgotten when leaving requires remembering a URL.
- **Both ids are in every audit entry.** The action was taken *as* the user, *by* a staff member;
  losing either half makes the trail a lie in one direction or the other.

Ending it is a tenant route (`/stop-impersonating`), so it has no staff middleware — which means the
actor for that audit entry comes from the **session**, not from the guard. Taking it from the guard
recorded an "ended by nobody" entry, which is worse than none because it looks like a record.

### The audit trail

Append-only. Nothing updates a row; the only thing that deletes one is `PruneAuditLogsJob` at the
end of a **two-year** window — longer than anything else here, because the questions an audit trail
answers arrive late.

`AuditService` never throws. A support agent whose "suspend this workspace" 500s because the audit
insert broke will simply do it again, and now there are two attempts and still no record.

Action strings are a closed set in `AUDIT_ACTIONS` and are treated like API error codes: screens
filter on them and support reads them months later, so renaming one orphans the history it
describes.

### The dashboard numbers

Computed from our own tables, never fetched from the payment provider — this screen is opened when
something is wrong, which is exactly when an outbound call is least likely to answer. Where our view
disagrees with the provider, `billing:sync` is the tool that says so.

**MRR** is the list price of every *entitling* subscription, `past_due` included: the customer is
still on the plan and we are still trying to collect, so excluding them would make a dunning problem
look like churn. It knows nothing about discounts or proration, and the screen says so.

**Churn** is null rather than zero when there is nothing to divide by — a shop with no customers has
not retained them all.

### Subscriptions

Two actions only: **ask the provider again** (sync) and **tell them to stop** (cancel). Never "edit
our copy". Cancelling goes to the provider and lets the resulting webhook change our row — our copy
agreeing without the provider would leave a customer billed for a plan the admin panel says they
cancelled.

### The IP allowlist

`ADMIN_IP_ALLOWLIST` (comma-separated) gates the whole of `/admin`, login page included. Empty
disables it, which is the right default for a laptop and the wrong one for production.

It is a **second layer, never the boundary** — the staff guard and mandatory two-factor are, and an
allowlist is trivially defeated by anything that can spoof a proxy header. The refusal is a **404**
so that somebody probing for an admin panel learns nothing.

## Hardening

Everything in this section is M8, and all of it is the kind of thing that breaks quietly. Each
piece has a test in `tests/functional/hardening/` for exactly that reason.

### Rate limits on the way in

`start/limiter.ts` defines the limits and the route files attach them; the organisation API has its
own, older set in `app/middleware/api_rate_limit.ts` (§11). Four keys, and which key a limit uses is
the interesting part:

| Limit | Keyed by | Why that key |
|---|---|---|
| The signed-out surface | address | Blunt cover for anything a script points at `/login`, `/signup`, a reset link or an invitation URL. |
| Sign-in, back-office sign-in | address **and** account | Keyed on the account alone, anyone could lock a known address out of their own login from somewhere else. Keyed on the address alone, a guesser gets a fresh allowance per account they try. |
| Password reset, verification resend | account | What is being protected is somebody's inbox, and our sender's reputation. |
| Second factor | the pending challenge | Six digits is a million guesses; unthrottled, that is minutes of scripting. |

Two behaviours worth knowing before you tune a number:

- **It counts requests, not failures.** A successful login spends a point exactly as a wrong
  password does, so every window is sized for a person having a bad morning behind an office NAT.
  Counting only failures means consuming from the controller instead of the middleware — one call
  to `limiter.use()` on the failure branch — and giving up the property that the limit applies
  before any of your code runs.
- **A throttled form goes back to the form.** The limiter's own response is a `text/plain` 429,
  which is right for the API and a dead end for somebody signing in, so `HttpExceptionHandler`
  turns it into a flash message and a redirect back. A throttled `GET` keeps the plain 429.

Tests share a process and an address, so `tests/bootstrap.ts` clears the limiter between tests. Any
suite that signs in more than ten times without it will fail somewhere unrelated to its own change.

### `TRUST_PROXY`, and why it matters more than it looks

`request.ip()` is what every limit above counts against, what the audit log records, and what
`ADMIN_IP_ALLOWLIST` compares. `config/app.ts` decides whether `X-Forwarded-For` is believed, and
both ways of getting it wrong are silent: off behind a load balancer, every customer shares one
bucket and the audit trail records one address forever; on with nothing in front, the header is
whatever the client typed and the limits are evaded by changing it.

Set it when — and only when — something you control sits in front of the process. Turned on it
trusts one hop, which is right for a single load balancer and one short for a CDN in front of one;
`config/app.ts` says what to change and why the number has to match your topology exactly.

### The content security policy

`config/shield.ts`, enabled and enforced. The load-bearing part is `script-src 'self' '@nonce'`:
an injected `<script>` carries no nonce, so it does not run, which is the failure mode this exists
to survive. Three deliberate compromises are in there with their reasons — `'unsafe-eval'` for
Alpine's expression compiler, `'unsafe-inline'` for styles, and `form-action` allowing any HTTPS
target because checkout is a form POST that redirects off-site.

Things that will bite you:

- **An inline `<script>` needs `nonce="{{ cspNonce }}"`.** Without it the browser drops the script
  and says so only in the console. The `@vite` tag is given the nonce in `layouts/base.edge`.
- **A new external origin needs a directive.** A CDN font, an analytics script, an object-storage
  domain: each is one line, and the symptom of forgetting is a missing asset with no server-side
  error.
- **Alpine expressions cost `'unsafe-eval'`.** If you ever need to drop it, that means
  `@alpinejs/csp` and rewriting every `x-show="a && b"` as a getter on an `Alpine.data` component.
- While tightening a directive on a live site, `CSP_REPORT_ONLY=true` reports violations without
  blocking anything.

`app/middleware/security_headers.ts` adds the four headers Shield has no setting for
(`Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`,
`X-Permitted-Cross-Domain-Policies`). It is on the **server** stack, so a 404 gets them too.

### Escaping

Edge escapes `{{ }}` and does not escape `{{{ }}}`. In a component, slot output is already-rendered
markup and must be raw; a `text` prop is a *value* and must not be. Several flash messages are
built from something a person typed — a file name, a list name — so this is not theoretical, and
`tests/functional/hardening/output_escaping.spec.ts` pins it.

A textarea is the sharp edge: its content is text, `</textarea>` in old input closes the element
early, and the value must sit on the same line as the tag or the parser eats a leading newline.

### Browser tests

`tests/browser/` drives a real Chromium through the five flows that a functional test cannot fully
stand in for: signup, sign-in with a second factor, invitation acceptance, the checkout handoff and
a file upload. `npx playwright install chromium` once, then `node ace test browser`.

No asset build is needed — outside production the assets come from Vite. They are the only tests
that see a Content-Security-Policy violation, an Alpine component that never booted, or a form that
posts fields the controller does not read, which is exactly why the list is short and stays short.

## Notifications

One-way, in-app announcements written by staff (plan §20). Nothing in the application emits one: a
receipt is an email, a quota block is a 402. That keeps the table at tens of rows a year, which is
the assumption the rest of the design rests on.

### The one cross-tenant surface

`notifications` has **no `organization_id`**. One row reaches every workspace on the Pro plan —
crossing tenants *is* the feature — which makes `app/notifications/audience.ts` the only place in
the application where a decision is made without a tenant filter, and the only place a leak would
not be caught by the rule in "Tenancy rules" above.

So it is one small pure function: no query, exhaustive over a closed union of audience types, and
**closed by default** — anything unrecognised reaches nobody. An announcement that reaches nobody is
a support ticket; one that reaches everybody is an incident.

It has its own exhaustive unit test (`tests/unit/notification_audience.spec.ts`, every type ×
role × plan) and its own cases in `tests/functional/tenant_isolation.spec.ts`. **Change the
predicate, extend both.**

`audience_type` decides which fields of the `audience` payload are used, and
`#notifications/input` drops the rest — an author who picks `users` after filling in plans must not
leave a `planKeys` list in the row, invisible to the UI and ignored by the predicate until somebody
widens the rule.

### Unread is one column

`users.notifications_seen_at`. No receipts table, no row per user per announcement. The dot is
"does anything that applies to me have `published_at` later than this", and reading the column
**before** stamping it is what gives the page its "new since your last visit" highlight — stamp
first and nothing is ever new.

Two consequences worth knowing:

- **A one-second blind spot.** Timestamps store to the second, so an announcement published in the
  same second somebody loads a page gets no dot for them. `>=` would instead leave the dot lit on
  something they just read, which is a wrong answer a user can see. The message is not lost either
  way — the feed shows every live announcement regardless of `seen_at`.
- **It does not scale to per-event notifications.** If notifications ever become one-per-job or
  one-per-assignment, the candidate set stops being bounded and the in-memory audience filter
  becomes a table scan on every page load. The upgrade is a `notification_recipients` table written
  at publish time. Do not start emitting per-event rows into this table instead.

### Authoring

Admin only (`StaffPolicy.manageNotifications`), for the same reason a plan override is: it changes
what a customer experiences and cannot be taken back. Support can read the list, because "did they
get told?" is a support question.

The back-office shows the reach of every announcement **from the same predicate the feed uses** — a
"reaches N people" figure computed a second way would eventually disagree with who actually sees
it, and only after publishing.

Deleting is soft and takes it off every screen at once; `PruneNotificationsJob` removes the row
after 30 days. Deleting does not unsend: anybody who read it, read it, and the flash says so.

## Local email

Nothing is sent inline — `MailerService` renders the message and queues it, so a provider outage
delays a verification email rather than losing it. **A queued email is not delivered until a worker
runs.**

Transactional email goes to [Mailpit](https://mailpit.axllent.org) in development, so nothing
leaves your machine:

```bash
brew install mailpit && mailpit          # or: docker run -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Then open http://localhost:8025. With Mailpit not running the job fails and retries with backoff
rather than losing the message — you can watch that happen on the admin Job queue screen.

The from-address lives in `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME` and is applied by `MailerService`.
Beware: `node ace configure @adonisjs/mail` overwrites both with its own placeholders
(`app@yourdomain.com`), and nothing fails when it does — the wrong sender simply goes out. Check
`.env` after re-running any `configure`.

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
It also creates one workspace per paid tier, each with a live subscription and a few payments, so
the billing screens have something to render without a Creem account. Development only: the command
refuses to run unless `NODE_ENV=development`.

## Frontend

`example-ui/index.html` is the **visual reference**, not code to port. It is a Mithril prototype
with fixture data; its CSS is what transfers, and it has been extracted into `resources/css/`.
Screens are Edge templates with Alpine.js for interactivity (plan §13).

- Nothing hardcodes a colour. Every value comes from a token in `resources/css/tokens.css`.
- Application content is capped at `--content-max-width` and centred beside the sidebar. The topbar
  stays full-bleed but its inner row shares the same cap, and the horizontal padding lives *inside*
  both capped boxes — put it on the bar instead and the page title stops lining up with the page.
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
