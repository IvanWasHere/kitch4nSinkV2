# AdonisJS v7 SaaS Boilerplate — Implementation Plan

> Status: planning document. Nothing built yet.
> Target: a reusable, multi-tenant SaaS starter — server-rendered (Edge), SQLite locally,
> Postgres in production, Creem for payments, Resend for email, Cloudflare R2 for files.

---

## 1. Goals & non-goals

**Goals**

- A boilerplate you can clone and have a billable, multi-tenant SaaS running in an afternoon.
- Every third-party dependency sits behind an interface we own, so swapping Creem → Stripe/Paddle,
  or Resend → Mailgun/SES, is a config change plus one new class — never a refactor.
- Identical code path on SQLite (local, zero setup) and Postgres (deployed). No `if (isSqlite)`
  branches in application code; portability is enforced at the migration layer.
- A **real, small domain — shared to-do lists** — so the boilerplate demonstrates plan-gated
  limits (lists per org, todos per list, seats) end to end rather than shipping empty CRUD.
- No Redis, no Docker required to run locally. `git clone && npm i && node ace migration:run && npm run dev`.

**Non-goals (deliberately out of scope for v1)**

- Per-seat or usage-metered billing (flat tiers only — see §7).
- Users belonging to multiple organisations (see §5, Decision D1).
- Real-time features (websockets/SSE), i18n, mobile apps.

---

## 2. Verified stack facts

These were checked against current docs rather than assumed, because several are new in v7.

| Fact | Status |
|---|---|
| AdonisJS **v7** shipped, requires **Node.js 24+** (local: v25.9.0 ✓) | confirmed |
| Official **Hypermedia starter kit**: Edge + Alpine.js + Vite + Japa + custom CSS, with working login/signup | confirmed |
| v7 replaces `ts-node` with `ts-exec` (SWC JIT) | confirmed |
| v7 adds **Transformers** (`BaseTransformer.toObject()`) — explicit response shapes, replaces implicit model serialization | confirmed |
| v7 auto-names routes from controllers (`posts.index`); `#generated/controllers` barrel files remove manual lazy imports | confirmed |
| v7 Lucid generates **typed schema classes** from migrations — models no longer redeclare `@column()` | confirmed |
| v7 Lucid adds `truncateAllTables()` for test teardown | confirmed |
| `@adonisjs/mail` ships a **Resend** transport (also smtp, ses, mailgun, postmark, sparkpost, brevo) + `sendLater` | confirmed |
| `@adonisjs/drive` (FlyDrive) ships an **`r2`** driver; `region: 'auto'` + account endpoint; `getUrl` / `getSignedUrl`; `file.moveToDisk(key)` | confirmed |
| Creem is a **merchant of record** (handles VAT/GST/sales tax in 190+ countries) | confirmed |
| Creem webhooks: header **`creem-signature`**, **HMAC-SHA256 over the raw body**, retries at 30s / 5m / 30m / 6h (5 attempts total) | confirmed |
| Creem event envelope: `{ id, eventType, created_at, object }` | confirmed |
| v7 security fix CVE-2026-21440: `file.move()` now uses random UUIDs by default | confirmed |
| **No official queue package yet** (queues/scheduler on the roadmap) | confirmed → drives Decision D2 |

**To verify during M0** (docs site was rebuilt for v7 and some URLs moved):
- Exact `@adonisjs/limiter` database-store config shape (we need it — no Redis).
- Whether `@adonisjs/ally` v7 API differs from v6 for the Google/GitHub drivers.
- Whether the access-tokens guard can attach to a non-User model (see §11, Decision D4).

---

## 3. Decisions log

| # | Decision | Rationale |
|---|---|---|
| **D1** | **One organisation per user** (`users.organization_id`), `organizations.owner_id` = main user | Chosen by owner. Simplest scoping; no pivot, no org switcher. **Cost:** a person needing two orgs must register twice. Mitigation in §5.4. |
| **D2** | **DB-backed job queue**, no Redis | Same code on SQLite and Postgres, durable across restarts, jobs inspectable in the admin panel, zero extra infra/cost. |
| **D3** | **Flat plan tiers, limits in `config/plans.ts`** | Limits/features are a typed code change, not a migration. Gating is a pure function testable without touching Creem. |
| **D4** | **Hand-rolled `api_keys` table** rather than the access-tokens guard | Keys belong to an **organisation**, not a user; we need a displayable prefix, scopes, `last_used_at`, and revocation. Avoids fighting the guard's user-centric assumptions. |
| **D5** | **Separate `staff_users` table + separate `staff` guard** | Staff (admin/support) are structurally different from tenants. Physical separation means a staff row can never leak into an org-scoped query and there is no role-escalation path on the tenant `users` table. Login lives at `/admin/login`. |
| **D6** | **Integer PKs + public prefixed ids** (`org_7fj2k9`, `key_a81bd0`) | Sequential ints in a public API leak customer counts and invite enumeration. UUID column types differ between SQLite and Postgres; a string `public_id` behaves identically on both. |
| **D7** | **Bouncer policies** for all authorisation | One place to answer "can this actor do this?", unit-testable, reusable from web controllers and API alike. |
| **D8** | **Demo domain = shared to-do lists**, org-scoped | The original brief says a member has access to their organisation's data, so lists belong to the **organisation**, not to the member who made them. Gives us three natural, differently-shaped quotas (§7.3) and the worked resource for the v1 API (§11). |
| **D9** | **Over-limit orgs soft-lock: keep everything, block creation** | Chosen by owner. A lapsed card must never destroy customer work. Existing rows stay readable *and editable*; only `create` is gated, so enforcement lives in one guard per resource and re-upgrading is instant with no restore job. |

---

## 4. Repository layout

```
app/
  todos/                      # the app itself (D8)
    list_service.ts           # list CRUD + `lists` quota guard (locks, §7.4)
    todo_service.ts           # todo CRUD, complete, assign + `todosPerList` quota guard
    position.ts               # sparse ordering / rebalance
  billing/
    contracts.ts              # PaymentProvider interface + normalized event types
    providers/creem.ts        # CreemProvider implements PaymentProvider
    plan_service.ts           # entitlement checks + limit_overrides merge + usage counts
    webhook_handler.ts        # normalized event -> domain mutations (idempotent)
  storage/
    contracts.ts              # FileStorage interface (thin wrapper over Drive)
    file_service.ts           # upload, quota accounting, signed URLs, soft delete
  mail/
    mailer_service.ts         # templated sends; queues via sendLater
    mails/                    # one class per transactional email
  queue/
    contracts.ts              # Job interface
    queue_service.ts          # dispatch(), reserve(), release(), fail()
    jobs/                     # ProcessWebhookJob, SendMailJob, PurgeFilesJob,
                              # ReconcileCountersJob, NormalizePositionsJob, OverdueDigestJob, ...
  controllers/
    auth/  organizations/  todos/  billing/  files/  settings/
    api/v1/                   # organisation-facing API
    admin/                    # staff back-office
  middleware/
    api_key_auth.ts  require_organization.ts  require_owner.ts
    ensure_verified_email.ts  ensure_two_factor.ts  track_api_usage.ts
  models/
  policies/
  transformers/               # v7 BaseTransformer subclasses (API responses)
  validators/                 # VineJS schemas
  exceptions/
config/
  plans.ts  payments.ts  storage.ts  mail.ts  database.ts  limiter.ts  ally.ts
database/
  migrations/  seeders/  factories/
resources/
  views/
    layouts/    { marketing, auth, app, admin }.edge
    components/ # from the starter kit + our additions
    pages/      # auth/, dashboard/, settings/, billing/, admin/
    emails/     # Edge templates for transactional mail
  css/  js/
start/
  routes/       { web, auth, api, admin }.ts
  kernel.ts  env.ts  bouncer.ts  validator.ts
commands/
  queue_work.ts  queue_retry.ts  billing_sync.ts  staff_create.ts
tests/
  unit/  functional/  browser/
example-ui/
  index.html                  # design reference — Mithril prototype, NOT the implementation (§13)
```

---

## 5. Data model

### 5.1 Portability rules (SQLite ↔ Postgres)

These are the whole of "works on both". Enforce in review:

1. `table.increments()` / `table.bigIncrements()` for PKs — never Postgres `serial`/`identity` DDL by hand.
2. `table.json()` for JSON columns. Lucid serialises to TEXT on SQLite, `json` on Postgres. Always
   `JSON.parse`/`stringify` through a model `prepare`/`consume` pair so behaviour is identical.
3. `table.timestamp(name, { useTz: true })` everywhere. Store UTC; never rely on DB `now()` defaults.
4. **No column alters.** SQLite's `ALTER TABLE` is severely limited. To change a column: new column →
   backfill migration → drop old. Codify this in `CONTRIBUTING.md`.
5. No DB-specific types: no `citext`, `enum`, `array`, `jsonb` operators, partial indexes, or `ILIKE`.
   Case-insensitive email = store `email` lowercased at the model layer, plain unique index.
6. No raw SQL in application code. The one sanctioned exception is the queue reservation query (§9),
   which is dialect-switched in exactly one place.
7. Booleans via `table.boolean()`; read through Lucid (SQLite gives 0/1, Lucid normalises).
8. Money as **integer minor units** (`amount_cents`), never float/decimal.

### 5.2 Tables

Every tenant-owned table carries `organization_id` and an index on it. `public_id` is a prefixed
nanoid, unique, exposed in URLs and the API.

**`organizations`**
`id`, `public_id` (`org_…`), `name`, `slug` (unique), `owner_id` → users.id (nullable, set post-create),
`plan_key` (default `free`), `status` (`active|past_due|canceled|suspended`), `trial_ends_at`,
`storage_used_bytes` (bigint, default 0), `limit_overrides` (json, nullable — staff grants, §7.4),
`created_at`, `updated_at`, `deleted_at`

**`users`** — tenant users only
`id`, `public_id` (`usr_…`), `organization_id` → organizations.id, `role` (`owner|member`),
`email` (unique, lowercased), `password` (nullable — social-only accounts), `full_name`,
`avatar_key` (nullable, R2 key), `email_verified_at`, `two_factor_secret` (encrypted, nullable),
`two_factor_recovery_codes` (encrypted json, nullable), `two_factor_confirmed_at`,
`last_login_at`, `created_at`, `updated_at`, `deleted_at`

**`staff_users`** — company staff (D5)
`id`, `public_id` (`stf_…`), `email` (unique), `password`, `full_name`, `role` (`admin|support`),
`two_factor_secret`, `two_factor_recovery_codes`, `two_factor_confirmed_at`, `disabled_at`, timestamps

**`social_accounts`**
`id`, `user_id`, `provider` (`google|github`), `provider_user_id`, `provider_email`,
`access_token` (encrypted, nullable), timestamps — unique(`provider`, `provider_user_id`)

**`auth_tokens`** — email verification + password reset
`id`, `user_id`, `type` (`verify_email|reset_password`), `token_hash` (sha256), `expires_at`,
`consumed_at`, `created_at` — index(`token_hash`)

**`invitations`**
`id`, `public_id` (`inv_…`), `organization_id`, `email`, `role`, `token_hash`,
`invited_by_user_id`, `expires_at`, `accepted_at`, `revoked_at`, timestamps
— unique(`organization_id`, `email`) where not accepted

**`subscriptions`**
`id`, `organization_id`, `provider` (`creem`), `provider_subscription_id`,
`provider_customer_id`, `plan_key`, `status` (`trialing|active|past_due|paused|canceled|expired`),
`current_period_start`, `current_period_end`, `cancel_at_period_end` (bool),
`trial_ends_at`, `canceled_at`, timestamps
— unique(`provider`, `provider_subscription_id`), index(`organization_id`)

**`payments`**
`id`, `public_id` (`pay_…`), `organization_id`, `subscription_id` (nullable), `provider`,
`provider_order_id` (unique per provider), `amount_cents`, `currency`, `status`
(`succeeded|refunded|partially_refunded|disputed`), `refunded_amount_cents`, `description`,
`receipt_url`, `occurred_at`, timestamps

**`webhook_events`** — the idempotency ledger
`id`, `provider`, `provider_event_id` (**unique**), `event_type`, `payload` (json),
`signature_verified` (bool), `received_at`, `processed_at`, `attempts`, `last_error`
> The unique constraint on `provider_event_id` is what makes Creem's 5 retries harmless.

**`api_keys`** (D4)
`id`, `public_id` (`key_…`), `organization_id`, `name`, `prefix` (first 8 chars, shown in UI),
`key_hash` (sha256 of the full key), `scopes` (json array), `last_used_at`, `expires_at`,
`revoked_at`, `created_by_user_id`, timestamps — index(`key_hash`), index(`organization_id`)

**`api_requests`** — usage counting + debugging
`id`, `organization_id`, `api_key_id`, `method`, `path`, `status`, `duration_ms`, `ip`, `created_at`
— index(`organization_id`, `created_at`). Rolled up nightly, pruned after 30 days.

**`files`**
`id`, `public_id` (`fil_…`), `organization_id`, `user_id`, `disk`, `key` (R2 object key),
`original_name`, `mime_type`, `size_bytes`, `visibility` (`public|private`), `checksum`,
`attachable_type` / `attachable_id` (nullable polymorphic), timestamps, `deleted_at`
> Store the **key only**, never a URL — that is what lets us move providers.

**`todo_lists`** — the demo domain (D8)
`id`, `public_id` (`lst_…`), `organization_id`, `created_by_user_id`, `name`, `description`,
`color` (token name, not a hex), `position` (int, manual ordering), `todos_count` (int,
denormalised — see §5.5), `archived_at`, timestamps, `deleted_at`
— index(`organization_id`, `position`), unique(`organization_id`, `name`) among non-deleted

**`todos`**
`id`, `public_id` (`tdo_…`), `organization_id` (denormalised from the list — see below),
`todo_list_id`, `created_by_user_id`, `assigned_to_user_id` (nullable), `title`, `notes`,
`priority` (`low|normal|high`), `due_at`, `completed_at`, `completed_by_user_id`,
`position`, timestamps, `deleted_at`
— index(`todo_list_id`, `position`), index(`organization_id`), index(`assigned_to_user_id`)

> `todos.organization_id` is deliberately denormalised. It means the tenant-isolation rule
> ("every query filters on `organization_id`") holds for `todos` without a join, so a forgotten
> join can never leak another org's rows. A DB-level check that it matches
> `todo_lists.organization_id` is added on Postgres; on SQLite it is enforced in the model's
> `beforeSave` hook and covered by a test.

**`jobs`** (§9)
`id`, `queue`, `name`, `payload` (json), `attempts`, `max_attempts`, `available_at`,
`reserved_at`, `reserved_by`, `failed_at`, `last_error`, `created_at`
— index(`queue`, `available_at`, `reserved_at`)

**`audit_logs`**
`id`, `organization_id` (nullable — staff/system actions), `actor_type`
(`user|staff|api_key|system`), `actor_id`, `action`, `subject_type`, `subject_id`,
`metadata` (json), `ip`, `user_agent`, `created_at`

### 5.3 Migration order

`organizations` (no FK) → `users` → FK `organizations.owner_id` → `staff_users` →
`social_accounts` → `auth_tokens` → `invitations` → `subscriptions` → `payments` →
`webhook_events` → `api_keys` → `api_requests` → `files` → `todo_lists` → `todos` →
`jobs` → `audit_logs`

Circular FK (`organizations.owner_id` ↔ `users.organization_id`) is broken by adding the
`owner_id` FK in its own follow-up migration — SQLite cannot add an FK to an existing table,
so define `owner_id` as a plain nullable integer column with an index and enforce the
relationship in the model + a Postgres-only constraint added at deploy time if desired.

### 5.4 Living with one-org-per-user (D1)

The known cost is that one email cannot exist in two organisations. Contain it now so it stays cheap:

- **Never** query `users` without `organization_id` outside auth/staff paths.
- Route every scoped query through a single `OrganizationScope` helper / model scope so that the
  day the pivot arrives, there is one place to change.
- Keep `role` on `users` as `owner|member` — the same value set a future `memberships.role` would use.
- Invitation to an email that already has an account → explicit, friendly error
  ("that address already belongs to another workspace"), not a silent failure.

### 5.5 Counting for quotas

Three limits are counts, and a naive `count() → compare → insert` is a race: two concurrent
requests both read 49 and both insert, giving 51 todos on a 50 cap. How each is made safe:

| Limit | Counted as | Race safety |
|---|---|---|
| `seats` | `users` where `organization_id = ?` and `deleted_at is null`, **plus** pending invitations | Serialised by the invite flow — accept-invite takes a transaction and re-checks inside it |
| `lists` | `todo_lists` where `organization_id = ?`, not deleted (**archived lists still count** — archiving is a UI convenience, not a quota escape) | `SELECT … FOR UPDATE` on the `organizations` row inside the create transaction (Postgres); `BEGIN IMMEDIATE` on SQLite |
| `todosPerList` | `todo_lists.todos_count` | Same transaction as the insert: lock the list row, re-check, insert, `todos_count++` |

`todo_lists.todos_count` is denormalised because the per-list cap is checked on **every** todo
create, and a `COUNT(*)` per keystroke-fast create is the first thing to hurt. Rules:

- Only ever mutated inside the same transaction as the todo insert/delete — never as a separate step.
- **Completed todos still count.** A 50-todo list that is fully ticked off is still full; the way
  out is to delete or move them. Say this in the UI, because it will otherwise read as a bug.
- Soft-deleted todos do **not** count, so the counter decrements on delete.
- A nightly `ReconcileCountersJob` recomputes every list's `todos_count` and logs drift. Drift
  means a bug, so it alerts rather than silently repairing.

### 5.6 Domain behaviour — lists and todos

Small on purpose. The domain exists to exercise tenancy, quotas, and the API; it is not the product.

- **Lists belong to the organisation** (D8), not to their creator. Every member sees every list.
  `created_by_user_id` is provenance for the UI, never an access check.
- **Completion is a timestamp**, not a boolean: `completed_at` + `completed_by_user_id`. Un-ticking
  nulls both. This gives "completed this week" for free and avoids a second `completed_by` boolean
  going stale.
- **Assignment** is optional and must be to a user in the **same organisation** — validated, not
  assumed, because it is the obvious cross-tenant injection point (`assigned_to_user_id` from a
  request body).
- **Ordering** is a manual `position` integer, reordered by drag in the UI. Sparse values
  (100, 200, 300) so an insert between two rows is a single write; a `NormalizePositionsJob`
  rebalances a list when gaps run out.
- **Archive vs delete.** Archiving a list (member) hides it and is reversible; **archived lists
  still count against the `lists` quota** (§5.5) so archiving cannot be used to dodge the cap.
  Deleting (owner) soft-deletes the list and its todos, and *does* free quota.
- **Due dates** are stored UTC and rendered in the org's timezone (`Store Settings` in the mockup's
  Settings screen supplies it). An `OverdueDigestJob` emails assignees daily — a second real
  consumer of the queue and the mailer.
- Deleting a **user** nulls `assigned_to_user_id` and preserves `created_by_user_id` as a tombstone;
  it never cascades to todos, because that would delete shared work when someone leaves.

---

## 6. Roles & authorisation

**Tenant roles** (`users.role`)

| | member | owner |
|---|---|---|
| View every list and todo in the organisation (D8) | ✓ | ✓ |
| Create lists; create, edit, complete, assign, delete todos | ✓ | ✓ |
| Rename / archive a list | ✓ | ✓ |
| **Delete** a list (and its todos) | | ✓ |
| Upload files, edit own profile, own 2FA | ✓ | ✓ |
| Invite / remove members, change roles | | ✓ |
| **Billing**: checkout, plan change, portal, invoices | | ✓ |
| **API keys**: create, view prefix, revoke | | ✓ |
| Rename / delete organisation, transfer ownership | | ✓ |

List *deletion* is owner-only because it cascades to every todo inside it and is the one
destructive action a member could take against shared work; archiving is the member-safe
equivalent.

**Staff roles** (`staff_users.role`)

| | support | admin |
|---|---|---|
| Search orgs/users, view subscription + payment state | ✓ | ✓ |
| View audit log, job queue, webhook ledger | ✓ | ✓ |
| **Impersonate** a tenant user (time-boxed, always audited) | ✓ | ✓ |
| Resend verification / invitation, unlock account | ✓ | ✓ |
| Grant credit, override plan, cancel subscription | | ✓ |
| Suspend / delete an organisation | | ✓ |
| Manage staff accounts | | ✓ |

Implemented as Bouncer policies (`OrganizationPolicy`, `BillingPolicy`, `ApiKeyPolicy`,
`MemberPolicy`, `FilePolicy`, `StaffPolicy`). **Every** policy takes the actor explicitly —
no implicit `auth.user`, so API-key actors and impersonating staff go through the same checks.

Impersonation rule: session stores `{ impersonatorStaffId, userId }`, a persistent banner is
rendered, the session hard-expires after 60 minutes, and **write** actions are denied for
`support` (read-only impersonation) while `admin` may write. Every impersonated request is
audit-logged with both actor ids.

---

## 7. Billing (Creem)

### 7.1 The abstraction

```ts
// app/billing/contracts.ts
export interface PaymentProvider {
  readonly name: string
  createCheckoutSession(i: CheckoutInput): Promise<{ url: string; sessionId: string }>
  createPortalSession(i: { customerId: string; returnUrl: string }): Promise<{ url: string }>
  getSubscription(id: string): Promise<ProviderSubscription | null>
  changePlan(i: { subscriptionId: string; productId: string }): Promise<ProviderSubscription>
  cancelSubscription(i: { subscriptionId: string; atPeriodEnd: boolean }): Promise<ProviderSubscription>
  resumeSubscription(id: string): Promise<ProviderSubscription>
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): boolean
  parseWebhook(rawBody: Buffer): NormalizedEvent
}

export type NormalizedEventType =
  | 'subscription.activated' | 'subscription.updated' | 'subscription.trialing'
  | 'subscription.past_due'  | 'subscription.paused'  | 'subscription.canceled'
  | 'payment.succeeded'      | 'payment.refunded'     | 'dispute.created'

export interface NormalizedEvent {
  providerEventId: string          // Creem `id` -> the idempotency key
  type: NormalizedEventType
  occurredAt: DateTime
  organizationPublicId?: string    // recovered from checkout metadata
  subscription?: ProviderSubscription
  payment?: ProviderPayment
  raw: unknown
}
```

`config/payments.ts` picks the driver by key (`creem`), exactly like `config/mail.ts` picks a
transport. Adding Stripe later = one new class in `app/billing/providers/` + a config entry.
**Nothing outside `app/billing/providers/` may import a provider SDK.**

### 7.2 Mapping Creem's 13 events onto 9 normalized ones

| Creem | Normalized |
|---|---|
| `checkout.completed` | `subscription.activated` (+ `payment.succeeded` if an order is attached) |
| `subscription.active` | `subscription.activated` |
| `subscription.paid` | `payment.succeeded` |
| `subscription.trialing` | `subscription.trialing` |
| `subscription.update` | `subscription.updated` |
| `subscription.past_due` | `subscription.past_due` |
| `subscription.unpaid` | `subscription.past_due` |
| `subscription.paused` | `subscription.paused` |
| `subscription.scheduled_cancel` | `subscription.updated` (`cancel_at_period_end = true`) |
| `subscription.canceled` | `subscription.canceled` |
| `subscription.expired` | `subscription.canceled` |
| `refund.created` | `payment.refunded` |
| `dispute.created` | `dispute.created` |

### 7.3 Plans config (D3)

```ts
// config/plans.ts
export const plans = {
  free: {
    name: 'Free', priceCents: 0, interval: null, creemProductId: null,
    limits: {
      seats: 2, lists: 3, todosPerList: 50,
      storageMb: 100, apiKeys: 0, apiCallsPerMonth: 0,
    },
    features: [],
  },
  pro: {
    name: 'Pro', priceCents: 2900, interval: 'month',
    creemProductId: env.get('CREEM_PRODUCT_PRO'),
    limits: {
      seats: 10, lists: 25, todosPerList: 500,
      storageMb: 5_000, apiKeys: 5, apiCallsPerMonth: 50_000,
    },
    features: ['api', 'customBranding', 'prioritySupport'],
  },
  business: {
    name: 'Business', priceCents: 9900, interval: 'month',
    creemProductId: env.get('CREEM_PRODUCT_BUSINESS'),
    limits: {
      seats: 50, lists: null, todosPerList: null,      // null = unlimited
      storageMb: 100_000, apiKeys: 25, apiCallsPerMonth: 1_000_000,
    },
    features: ['api', 'customBranding', 'prioritySupport', 'sso', 'auditExport'],
  },
} as const satisfies Record<string, PlanDefinition>

export type PlanKey = keyof typeof plans
export type LimitKey = keyof (typeof plans)['free']['limits']
export type FeatureKey = (typeof plans)[PlanKey]['features'][number]
```

`null` means unlimited — distinct from `0`, which means "not available on this plan" (Free gets
`apiKeys: 0`, so the API Keys screen is hidden entirely rather than shown empty).

Gating is a pure function over `organization.planKey` — no network call, no DB read:

```ts
if (!planService.can(org, 'api')) throw new UpgradeRequiredException('api')
await planService.assertWithinLimit(org, 'seats', currentSeatCount + 1)
```

Rendered in Edge as `@can('api')` / `@withinLimit('seats')` tags so upsell UI and server
enforcement read from the same source.

### 7.4 Enforcing the count limits (D9)

**Soft-lock.** Over-limit organisations keep every row, readable *and editable*. Only creation is
blocked. Nothing is ever archived or deleted by the system on downgrade, so a failed card costs a
customer nothing and re-upgrading needs no restore job.

The three quota checks, each at exactly one place:

```ts
// app/todos/list_service.ts
async createList(org: Organization, actor: User, data: CreateListData) {
  return db.transaction(async (trx) => {
    await this.plans.lockAndAssertLimit(trx, org, 'lists', () =>
      TodoList.query({ client: trx }).where('organization_id', org.id)
        .whereNull('deleted_at').count('* as total')
    )
    return TodoList.create({ ...data, organizationId: org.id }, { client: trx })
  })
}

// app/todos/todo_service.ts
async createTodo(org: Organization, list: TodoList, data: CreateTodoData) {
  return db.transaction(async (trx) => {
    const locked = await TodoList.query({ client: trx }).forUpdate()
      .where('id', list.id).where('organization_id', org.id).firstOrFail()
    this.plans.assertWithinLimit(org, 'todosPerList', locked.todosCount + 1)
    const todo = await Todo.create({ ...data, organizationId: org.id, todoListId: locked.id }, { client: trx })
    await locked.merge({ todosCount: locked.todosCount + 1 }).save()
    return todo
  })
}
```

Seats are checked in the invite-accept transaction (§5.5), counting members **plus pending
invitations** — otherwise ten simultaneous invites to a 2-seat plan all succeed.

**Presentation.** A blocked create is never a dead end:

- Web: `402`-equivalent flash + the `.plan-card` upsell inline, with the current usage
  ("25 of 3 lists"). The *Add list* button is disabled with a tooltip when already at the cap, so
  the block is visible before the click.
- API: `402 Payment Required`, `{ error: { code: 'plan_limit_exceeded', limit: 'lists',
  allowed: 3, current: 25, upgradeUrl } }`. A machine-readable `limit` key is what lets a customer's
  integration handle it rather than retry-loop.
- Usage meters on the dashboard turn amber at 80% and red at 100%, driven by the same
  `PlanService` numbers as enforcement — never a second, drifting calculation.

**Downgrade path.** The `subscription.canceled` / `.expired` webhook sets `plan_key = 'free'` and
nothing else. No data job runs. The next create attempt is what surfaces the new ceiling.

**Staff override.** Admins can raise a single org's limit without changing its plan via a nullable
`organizations.limit_overrides` (json) merged over the plan's limits — the standard "just let this
customer have 5 more lists while we sort out billing" request. Every override is audit-logged.

### 7.5 Flows

**Checkout** — owner picks a plan → `POST /billing/checkout` → policy check → provider
`createCheckoutSession({ productId, customerEmail, successUrl, metadata: { organizationPublicId } })`
→ 302 to Creem. The `metadata.organizationPublicId` is the thread that ties the webhook back to a
tenant; without it we cannot attribute the subscription.

**Return** — `/billing/return` is **optimistic UI only**: show "activating your subscription…",
poll the org's subscription status. The webhook is the source of truth; the return URL is never
trusted to grant access (a user can hit it by hand).

**Webhook** — `POST /webhooks/creem`, CSRF-exempt, raw-body preserved:

1. `verifyWebhook(rawBody, headers)` — HMAC-SHA256 over the raw body vs `creem-signature`,
   compared with `crypto.timingSafeEqual`. Fail → 401, log, stop.
2. `INSERT INTO webhook_events (provider_event_id, …)`. Unique-violation → already seen → **200 OK**, stop.
3. Dispatch `ProcessWebhookJob` (§9). Return **200 within ~50ms**.
4. Worker applies the normalized event to `subscriptions` / `payments` / `organizations.plan_key`,
   writes an audit log, stamps `processed_at`.

Ordering: events can arrive out of order. The worker **ignores an event older than the
subscription row's `updated_at` watermark** for the same subscription, and on any ambiguity
re-fetches the subscription from Creem (`getSubscription`) rather than trusting the payload.

**Portal / cancellation** — owner-only, `createPortalSession`, redirect. State changes come back
by webhook.

**Dunning** — `subscription.past_due` → org `status = past_due`, banner + email to owner.
`subscription.canceled|expired` → `plan_key = 'free'`, enforce free limits, keep data, block writes
that exceed the free tier.

**Reconciliation** — nightly `billing:sync` command diffs local subscriptions against Creem and
reports drift to the admin panel. Cheap insurance against a permanently-failed webhook.

### 7.6 Local development

Creem test mode + a tunnel (`cloudflared tunnel --url http://localhost:3333`) for webhooks, plus
`node ace billing:replay <webhook_event_id>` to re-run a stored payload against the handler with no
network at all. Seeder creates one org per tier so the UI can be built before Creem is wired up.

---

## 8. Email (Resend)

`@adonisjs/mail` already *is* the provider abstraction — Resend is a first-class transport, so
"extendable" is satisfied by config:

```ts
mailers: {
  resend: transports.resend({ key: env.get('RESEND_API_KEY'), baseUrl: env.get('RESEND_BASE_URL') }),
  smtp:   transports.smtp({ host: 'localhost', port: 1025 }),   // Mailpit, local dev
}
```

`MAIL_MAILER=smtp` locally (Mailpit at :1025/:8025), `resend` in production.

Three Resend specifics the boilerplate has to handle, because each one is a first-deploy failure:

1. **Domain verification.** Resend only sends from a domain you have verified via DNS (SPF + DKIM
   records, optionally a custom return-path). Until then the *only* usable from-address is
   `onboarding@resend.dev`, and it can only deliver to the account owner's own address. The
   deployment guide gets a short "verify your domain first" step, and `MAIL_FROM_ADDRESS` defaults
   to the sandbox sender so a fresh clone still sends something.
2. **Rate limit.** The Resend API allows ~2 requests/second by default; a queue worker draining a
   digest run will trip it. `SendMailJob` treats HTTP 429 as retryable (it already has backoff from
   §9), and the worker's mail concurrency is capped at 1 — bulk runs like `OverdueDigestJob` are
   naturally paced rather than bursted.
3. **Idempotency.** Resend accepts an `Idempotency-Key` header. `SendMailJob` passes the job's own
   `public_id`, so an at-least-once queue retry after a partial failure cannot double-send.

A thin `MailerService` owns from-address, reply-to, unsubscribe headers, idempotency key, and
per-locale templates, so no controller ever calls `mail` directly. Every send goes through our
**own** queue (§9) rather than `sendLater`'s in-memory queue, so a crash never loses a verification
email.

Templates live in `resources/views/emails/` (Edge), each with a plaintext counterpart.

Transactional set: verify email · reset password · password changed · team invitation ·
invitation accepted · welcome · subscription activated · payment receipt · payment failed ·
subscription canceled · storage quota warning · new sign-in from new device · API key created.

---

## 9. Background jobs (D2)

**`jobs` table + polling worker.** `node ace queue:work` in a second process (Procfile/systemd/
separate container).

Reservation — the one dialect-switched query in the codebase:

- **Postgres:** `SELECT … WHERE queue = ? AND reserved_at IS NULL AND available_at <= now()
  ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED` → `UPDATE … SET reserved_at = now(), reserved_by = ?`
- **SQLite:** single-worker `BEGIN IMMEDIATE` transaction doing the same select+update.
  (Local dev is single-worker; this is correct and simple.)

Semantics: at-least-once delivery → **every job handler must be idempotent**. Exponential backoff
(`available_at = now + 2^attempts * 30s`), `max_attempts` default 5, then `failed_at` set and the
job surfaced in the admin panel with a one-click retry. A `reserved_at` older than the visibility
timeout (5 min) is reclaimed — that is the crash-recovery path.

Jobs: `ProcessWebhookJob` · `SendMailJob` · `PurgeDeletedFilesJob` · `ExpireInvitationsJob` ·
`RollupApiUsageJob` · `SyncBillingJob` · `PruneAuditLogsJob`.

Scheduling: v7 has no scheduler yet — a `schedule:run` Ace command driven by system cron
(or a `--schedule` flag on the worker) enqueues the recurring jobs.

---

## 10. Files & storage (Cloudflare R2)

`config/storage.ts` (Drive): `fs` disk locally → `r2` disk in production. Application code only
ever names a disk, so this is a one-line env switch.

```ts
r2: services.r2({
  credentials: { accessKeyId: env.get('R2_ACCESS_KEY_ID'), secretAccessKey: env.get('R2_SECRET_ACCESS_KEY') },
  region: 'auto',
  bucket: env.get('R2_BUCKET'),
  endpoint: env.get('R2_ENDPOINT'),     // https://<account_id>.r2.cloudflarestorage.com
  visibility: 'private',
})
```

Key convention — **tenant prefix first**, so a bucket-level policy or a per-tenant export is trivial:
`orgs/{organization_public_id}/{yyyy}/{mm}/{uuid}.{ext}`

Rules:
- The DB stores `disk` + `key` only. Never a URL. (This is the single thing that makes provider
  migration possible.)
- Private by default; serve through `getSignedUrl` with a short TTL. Public assets (avatars, logos)
  go to a `public` disk fronted by a Cloudflare custom domain.
- Validate **before** moving: extension allowlist, MIME sniffing, per-file and per-plan size caps.
  v7's `move()` uses random UUID names by default (CVE-2026-21440) — keep that; never trust the
  client filename for the key.
- Quota: `organizations.storage_used_bytes` updated in the same transaction as the `files` insert;
  `PurgeDeletedFilesJob` reconciles nightly against the bucket for drift.
- Deletion is soft (`files.deleted_at`); the purge job removes objects after 30 days, so an
  accidental delete is recoverable.

---

## 11. Organisation API

- Base: `/api/v1`. JSON only. Versioned by URL segment.
- Auth: `Authorization: Bearer <key>`. Key format `sk_live_<32-char nanoid>` / `sk_test_…`.
  Shown **once** at creation; we persist only `prefix` + `sha256(key)`.
- Only the **owner** may create, list, or revoke keys (D4 + §6).
- `ApiKeyAuthMiddleware`: hash the presented key → lookup by `key_hash` → reject if revoked/expired
  → load org → check plan has the `api` feature → set `ctx.organization` + `ctx.apiKey` →
  update `last_used_at` (throttled to once/minute to avoid a write per request).
- **Every** API query is scoped by `ctx.organization.id`. No endpoint accepts an `organization_id`
  parameter — the key *is* the scope.
- Rate limiting with `@adonisjs/limiter` (database store, since no Redis), keyed by api key id.
  `limiter.multi()` for a burst rule + a monthly plan-quota rule in one call. Responses carry
  `X-RateLimit-Limit` / `-Remaining` / `-Reset`.
- Responses built with v7 **Transformers** — explicit `toObject()` shapes, so the public contract
  can never accidentally widen when a column is added to a model. Public ids only; internal
  integer ids never leave the process.
- Errors: RFC 7807-ish `{ error: { code, message, details? } }` with stable machine codes.
- Cursor pagination (`?cursor=&limit=`) — offset pagination breaks under concurrent writes.
- `X-Request-Id` echoed on every response and written to `api_requests` for support to trace.
- Ship an OpenAPI document generated from the transformers + validators, and a `/docs` page.

**Endpoints** — lists and todos are the worked resource (D8), which also answers what the API is
*for*: a customer syncing their org's tasks from another system.

```
GET    /api/v1/lists                     ?cursor=&limit=&archived=
POST   /api/v1/lists                     402 if at the `lists` cap
GET    /api/v1/lists/:public_id
PATCH  /api/v1/lists/:public_id
DELETE /api/v1/lists/:public_id          owner-scoped keys only (see below)

GET    /api/v1/lists/:public_id/todos    ?cursor=&limit=&completed=&assigned_to=
POST   /api/v1/lists/:public_id/todos    402 if at the `todosPerList` cap
GET    /api/v1/todos/:public_id
PATCH  /api/v1/todos/:public_id          title, notes, priority, due_at, assigned_to, position
POST   /api/v1/todos/:public_id/complete
DELETE /api/v1/todos/:public_id

GET    /api/v1/organization              plan, limits, and current usage — lets an integration
                                         check headroom before a bulk import
GET    /api/v1/members                   for resolving `assigned_to`
```

- **Scopes** on `api_keys` are `lists:read`, `lists:write`, `todos:read`, `todos:write`,
  `members:read`. A key is *not* a user, so destructive list deletion requires an explicit
  `lists:write` scope **and** is refused on read-only keys — the API mirrors §6's owner/member
  split through scopes rather than inheriting a role.
- `assigned_to` accepts a member's `public_id` and is validated against the calling org (§5.6);
  a foreign id is a `422`, never a silent null.
- `POST /lists` and `POST /todos` return **`402` with `plan_limit_exceeded`** and the numbers
  (§7.4) — the one API behaviour that is genuinely unusual and must be documented prominently,
  because integrations otherwise treat a non-2xx as retryable.
- Bulk import guidance in the docs: call `GET /organization` first, size the batch to the
  remaining headroom, and expect `402` mid-batch to be a stop signal rather than a failure.

---

## 12. Admin & support back-office

Separate guard, separate layout, mounted at `/admin`, IP-allowlistable via env, 2FA
**required** for staff.

Screens: dashboard (MRR, signups, churn, failed jobs, failed webhooks) · organisations
(search, detail: members/subscription/payments/files/usage) · users (search, resend verification,
unlock, reset 2FA) · subscriptions (state, manual sync, admin-only override/cancel) ·
webhook ledger (payload, signature status, replay) · job queue (pending/failed, retry) ·
audit log (filterable) · staff management (admin only).

---

## 13. Frontend & visual reference

### 13.1 `example-ui/index.html` is the visual spec

`example-ui/index.html` is the design reference for every tenant-facing screen. Build against it.

**Read it correctly:** it is a **Mithril 2.2 single-page prototype** — one file, client-side
routing, hardcoded fixture data, no server. It exists to answer *"what should this look like"*,
not *"how should this be built"*. **Do not port the Mithril.** Every screen is rebuilt as an Edge
template with Alpine.js for interactivity, per §13.3.

Run it with any static server (`npx serve example-ui`) and click through before starting M1.

**What transfers verbatim:** the CSS. The stylesheet is plain CSS custom properties with no build
step, no framework, and no preprocessor — it drops into the Hypermedia starter kit's own
`resources/css/` unchanged.

**What does not transfer:** the Mithril component functions, the client-side router
(`state.route`), the in-memory `state` object, and the `dummyOrders` / `dummyProducts` /
`dummyTickets` / `transactions` fixtures.

### 13.2 Design tokens

Extract `:root` into `resources/css/tokens.css` as the single source of truth. Nothing in the app
may hardcode a hex value.

```
Brand      --blue-50 … --blue-600     (#eff6ff → #2563eb)   primary = --blue-500
Neutral    --gray-50 … --gray-900     (#f9fafb → #111827)   body text = --gray-800
Semantic   --green-50/-500 success · --red-400/-500 danger
           --orange-50/-500 warning · --purple-50/-500 accent
Shape      --radius: 8px  (cards 12px, nav items 6px, pills 999px)
Motion     --transition: 180ms ease
Type       system font stack; 11/12/13/14/16/17/22px scale; weights 500/600/700
Surfaces   page --gray-50 · cards #fff · borders --blue-100 (not gray — this is what
           gives the UI its cool cast; keep it)
Focus      border --blue-400 + 3px rgba(59,130,246,0.08) ring
```

Breakpoints are already defined and must be preserved: **1024px** (grids collapse to 2-up),
**900px** (support layout goes single-column, list/detail toggle), **768px** (sidebar becomes an
off-canvas drawer with overlay), **480px** (single column, full-width dropdowns).

**Dark mode is not in the mockup.** Because every colour is already a custom property, adding it
is a second `:root` block under `prefers-color-scheme` — but the dark palette is ours to design,
not something to be read out of this file. Defer to M8.

### 13.3 Mockup → Edge/Alpine translation

| Mockup mechanism | Implementation |
|---|---|
| `state.route` client routing | Real server routes + full page loads |
| `m()` component functions | `.edge` components in `resources/views/components/` |
| `navigate('dashboard')` | `<a href>` / form POST + redirect, `urlFor()` for paths |
| `state.showPw` toggle | `x-data="{ show: false }"` |
| `showToast()` | Server flash message rendered into the existing `.toast` markup |
| `state.sidebarOpen` + overlay | `x-data` on the app layout |
| `state.notifMenuOpen` + outside-click | `x-data` + `@click.outside` |
| Password strength meter | `x-data` computing against the same 5-point scale |
| Auto-growing reply textarea | `x-data` on `input` |
| `activeTab` switching | Distinct routes (`/billing`, `/settings`, …) — each screen is a URL |

Rule: every interaction works as a plain form POST with JS disabled; Alpine only removes round
trips. The mockup's tab switching is the one pattern to explicitly *not* copy — those become real
URLs so they can be linked, bookmarked, and permission-gated server-side.

### 13.4 Component inventory (already designed — reuse, don't reinvent)

Port these from the mockup into `resources/views/components/`:

- **Forms** — `.field` / `.field-label` / `.field-input` / `.field-row`, `.input-wrap` +
  `.pw-toggle`, `.check-row`, `.strength-bar`
- **Buttons** — `.btn` × `primary | outline | ghost | danger`, `.btn-sm`, `.btn-xs`, `.btn-row`
- **Auth shell** — `.auth-wrapper`, `.auth-card`, `.logo`, `.divider`, `.back-link`, `.info-box`
- **App shell** — `.dash-layout`, `.dash-sidebar` (+ `.nav-section-title`, `.nav-item`,
  `.nav-icon`), `.sidebar-user`, `.sidebar-avatar`, `.dash-topbar`, `.topbar-icon-btn`,
  `.mobile-toggle`, `.sidebar-overlay`, `.dash-content`
- **Data display** — `.stat-card` grid, `.panel` / `.panel-header` / `.panel-body` / `.panel-grid`,
  `.orders-table`, `.tx-table`, `.badge` (8 variants), `.activity-item`
- **Billing** — `.billing-current`, `.plan-grid` / `.plan-card` (+ `.plan-badge` for current,
  `.plan-features`, `.plan-check`), `.tx-table`, `.tx-amount.refund`
- **Support** — `.support-layout`, `.ticket-list`, `.ticket-item`, `.conversation-panel`,
  `.msg` / `.msg-avatar` / `.msg-body`, `.reply-area`
- **Settings** — `.settings-grid`, `.settings-card`, `.settings-full`, `.section-title` /
  `.section-desc`, `.danger-zone`
- **Feedback** — `.toast-success` / `.toast-error`, `.notif-menu` dropdown
- **Products** — `.products-grid`, `.product-card`, `.product-stock` (`in|low|out`)

Missing from the mockup, to design in the same language: `pagination`, `modal`, `data-table`
empty/loading states, `file-upload` (drag & drop + progress), `usage-meter`, `empty-state`,
`copy-to-clipboard`, `impersonation-banner`, `avatar-upload`.

### 13.5 Screen coverage vs. this plan

The mockup covers **9 of ~30** screens. Everything below marked *build* is new work that must
still read as part of the same UI.

**Covered — port directly**

| Mockup screen | Plan target | Milestone |
|---|---|---|
| Sign in | `/login` | M1 |
| Create your store (register + strength meter) | `/register` — also creates the organisation | M1 |
| Reset password (+ "check your email" state) | `/forgot`, `/reset/:token` | M1 |
| Overview (4 stat cards, recent table, activity feed) | `/dashboard` — stats become Lists / Open todos / Completed this week / Overdue; the table becomes recent todos; the activity feed becomes list activity | M3.5 |
| Billing (current plan, plan grid, transaction history) | `/billing` | M4 |
| Support (ticket list + conversation) | `/support` | post-v1 |
| Settings → Profile Information | `/settings/profile` | M1 |
| Settings → Store Settings | `/settings/organization` — **owner only** | M2 |
| Settings → Security (change password) | `/settings/security` | M1 |

**Build — reusing the components above**

| Screen | Reuse | Milestone |
|---|---|---|
| Verify-your-email notice + "check your email" | `.auth-card` + the Forgot success state | M1 |
| 2FA setup (QR + confirm) / challenge / recovery codes | `.auth-card`, `.field`, `.info-box` | M1 |
| Social login buttons on sign-in/register | `.btn-outline` + `.divider` | M1 |
| **Team → members list** | `.panel` + `.orders-table` + `.badge` for role | M2 |
| **Team → invite member** modal, pending invites | new `modal` + `.field` + `.badge-pending` | M2 |
| Invitation accept (public, tokenised) | `.auth-card` | M2 |
| Ownership transfer | `.settings-card` + `.danger-zone` | M2 |
| Seat-limit-reached upsell | `.info-box` + `.plan-card` | M4 |
| `past_due` / `canceled` account banner | new banner on `.dash-topbar` | M4 |
| Storage usage meter | new `usage-meter` in `.stat-card` | M5 |
| **Lists** index (grid of list cards + counts) | `.products-grid` / `.product-card`, `.product-stock` recoloured as a "42 / 50 todos" pill | M3.5 |
| **List detail** (todos, filter, reorder, assign) | `.panel` + `.orders-table` + `.badge` for priority | M3.5 |
| Create / rename list modal | `modal` + `.field` | M3.5 |
| At-cap upsell on *Add list* / *Add todo* | `.info-box` + `.plan-card` + disabled `.btn` + tooltip | M4 |
| Usage meters (lists, seats, todos-per-list) | new `usage-meter` in `.stat-card` | M4 |
| **Files** browser + upload | `.products-grid` card shape + new `file-upload` | M5 |
| **API keys** list (prefix, last used, revoke) — **owner only** | `.panel` + `.tx-table` + `copy-to-clipboard` | M6 |
| API key created (shown once) | `modal` + `.info-box` | M6 |
| API usage / rate-limit view | `.stat-card` + `usage-meter` | M6 |
| Admin: dashboard, org search, org detail, subscriptions, webhook ledger, job queue, audit log, staff | whole `dash-*` shell, `admin` layout | M7 |
| Impersonation banner | new, fixed above `.dash-topbar` | M7 |
| Marketing: landing, pricing, legal | `.plan-grid`, `marketing` layout | M8 |
| 404 / 500 / maintenance | `.auth-wrapper` centred | M8 |

### 13.6 Deliberate divergences from the mockup

Six places where the mockup and this plan disagree. The plan wins; note them so nobody "fixes"
the difference back.

1. **Sidebar nav.** Mockup: Overview · Products / Billing · Support · Settings. Ours:
   `MAIN` Overview · Lists · Files — `TEAM` Members — `ACCOUNT` Billing · API Keys · Settings.
   **Billing and API Keys render only for `owner`** (§6); the mockup has no role concept.
   Each quota-bearing item shows its usage inline in the nav (`Lists 3/3`) so the ceiling is
   visible before a user hits it.
2. **Products / Orders / Activity are placeholders for the to-do domain** (D8). The mockup's
   *Products* screen becomes **Lists** — the `.product-card` grid is exactly the right shape for
   list cards, and `.product-stock` (`in|low|out`) maps onto a todo-count pill that turns amber
   near the `todosPerList` cap and red at it. The Overview table becomes recent todos. Keep every
   component; replace the subject matter.
3. **"Delete account" in the mockup's danger zone deletes the org.** Split it: *Leave organisation*
   (member) vs *Delete organisation* (owner, typed confirmation, and per §19 Q2 a grace period).
4. **Settings is one page with three cards in the mockup**; ours splits into `/settings/profile`
   (self), `/settings/organization` (owner) and `/settings/security` (self) so permissions map onto
   routes rather than onto sections of a page.
5. **The notification dropdown is fully designed but has no backend in this plan.** Either drop it
   from v1 or add a `notifications` table — decide at M2, don't leave it as dead UI.
6. **Support tickets are mockup-only.** A full ticketing system is out of scope for v1; ship a
   contact form that emails support, and keep the two-pane layout for when it is built.

### 13.7 Base kit

The official **Hypermedia starter kit** (Edge + Alpine.js + Vite + Japa, custom CSS with variables
and nesting) is the foundation. Keep its structure; replace its default stylesheet with the
mockup's. Do not add Tailwind, HTMX, or a component framework — the mockup needs none of them.

- Layouts: `marketing` · `auth` (`.auth-wrapper`) · `app` (`.dash-layout`) · `admin`.
- v7 auto-named routes + typed `urlFor()` — no hardcoded paths in templates.
- Flash messages and VineJS error bags wired through the kit's helpers, rendered into `.toast`
  and `.field` error markup.
- Accessibility pass at M8 — the mockup is not audited: nav `<button>`s need `aria-current`,
  the notification dropdown needs focus trapping and `aria-expanded`, the mobile drawer needs
  focus management, and colour contrast on `--gray-400` text needs checking.

---

## 14. Configuration & environment

```bash
# Core
NODE_ENV=development
PORT=3333
APP_KEY=                      # node ace generate:key
APP_URL=http://localhost:3333
LOG_LEVEL=info

# Database — sqlite locally, postgres deployed
DB_CONNECTION=sqlite          # sqlite | postgres
DB_SQLITE_PATH=./tmp/db.sqlite3
# DB_HOST= DB_PORT= DB_USER= DB_PASSWORD= DB_DATABASE= DB_SSL=

# Mail
MAIL_MAILER=smtp              # smtp (Mailpit) locally | resend in prod
MAIL_FROM_ADDRESS=onboarding@resend.dev       # replace once your domain is verified in Resend
MAIL_FROM_NAME="Acme"
RESEND_API_KEY=
RESEND_BASE_URL=https://api.resend.com

# Payments
PAYMENT_PROVIDER=creem
CREEM_API_KEY=
CREEM_API_URL=https://test-api.creem.io       # live: https://api.creem.io
CREEM_WEBHOOK_SECRET=
CREEM_PRODUCT_PRO=
CREEM_PRODUCT_BUSINESS=

# Storage
DRIVE_DISK=fs                 # fs locally | r2 in prod
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_ENDPOINT=
R2_PUBLIC_URL=                # custom domain for the public disk

# OAuth
GOOGLE_CLIENT_ID=  GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=  GITHUB_CLIENT_SECRET=

# Queue
QUEUE_WORKER_CONCURRENCY=5
QUEUE_POLL_INTERVAL_MS=1000
```

All validated in `start/env.ts` with VineJS; secrets declared with v7's `schema.secret()` so they
cannot be accidentally logged. Use the new `file:` modifier for secrets mounted from disk in prod.

---

## 15. Testing

- **Unit** — plan/entitlement logic (every limit × every plan, including `null` = unlimited and
  `0` = unavailable), webhook normalisation (fixture payloads for all 13 Creem events), signature
  verification, key hashing, queue backoff maths, storage key generation.
- **Quota suite** — its own file, because these are the rules customers pay for:
  create at cap → `402`; **concurrent** creates at cap-1 (two parallel requests, assert exactly one
  succeeds — the test that proves §5.5's locking); archived lists still count; completed todos
  still count; soft-deleted todos free quota; downgrade leaves rows intact and editable (D9);
  `limit_overrides` raises the ceiling; `todos_count` matches `COUNT(*)` after a randomised
  create/delete sequence.
- **Functional** — full HTTP flows: signup → verify → invite → accept → checkout webhook →
  entitlement change → API key → API call → rate limit. In-memory SQLite,
  `truncateAllTables()` between tests (v7).
- **Browser** (Japa + Playwright) — signup, login + 2FA, invite acceptance, plan upgrade,
  file upload. Kept to the handful of flows that actually break.
- **Tenant isolation suite** — a dedicated file that seeds two organisations and asserts, endpoint
  by endpoint, that org A can never read or mutate org B. This is the test that protects the
  product; run it in CI on every PR. Must include the todo-specific injection points: assigning a
  todo to org B's user, moving a todo into org B's list, and fetching a todo by org B's
  `public_id`.
- CI matrix: SQLite **and** Postgres. Portability rules (§5.1) are worthless unbenchmarked.

---

## 16. Deployment

- Dockerfile: multi-stage, `node ace build`, non-root user, Node 24 slim base.
- Two processes: `web` (`node bin/server.js`) and `worker` (`node ace queue:work`).
- Release phase: `node ace migration:run --force`.
- Postgres via `DATABASE_URL` (or discrete vars) + `DB_SSL=true`.
- `/health` (liveness) and `/ready` (DB + disk reachable) endpoints.
- Structured JSON logs; v7 `@adonisjs/otel` for zero-config OpenTelemetry traces.
- Backups: nightly `pg_dump`; R2 versioning enabled on the bucket.
- Creem webhook endpoint registered against the production URL; secret rotated per environment.

---

## 17. Build order

Each milestone ends green: migrations run on both engines, tests pass, app boots.

**M0 — Foundation**
Scaffold from the Hypermedia starter kit · dual `config/database.ts` · env schema ·
`public_id` helper + base model · Bouncer wiring · CI (lint, typecheck, test × SQLite/Postgres) ·
`CONTRIBUTING.md` with the §5.1 portability rules ·
**port `example-ui/index.html`'s CSS into `resources/css/` (tokens + components) and build the
four Edge layouts and the §13.4 component library against it** — do this first so every later
milestone assembles pages from ready-made parts instead of restyling as it goes.

**M1 — Auth**
Migrations for `users`/`organizations`/`auth_tokens`/`social_accounts` · registration creates
org + owner atomically · login/logout · email verification · password reset · TOTP 2FA with
recovery codes · Google/GitHub via Ally with account linking · `staff_users` + `/admin/login`.

**M2 — Organisations & teams**
Org settings · member list · invitations (create/accept/revoke/expire) · role changes ·
ownership transfer · seat limit enforcement · policies + the **tenant isolation test suite**.

**M3 — Queue & mail**
`jobs` table · `QueueService` · `queue:work` command · backoff/retry/reclaim ·
`MailerService` + all templates · Mailpit locally · admin job screen.
*(M3 before M4 deliberately — webhooks land on the queue.)*

**M3.5 — To-do domain** *(the app itself)*
`todo_lists` + `todos` migrations with the denormalised `organization_id` · list CRUD (create/rename/
archive by member, delete by owner) · todo CRUD, complete, assign, due dates · drag-reorder with
sparse `position` · `todos_count` maintained transactionally · `ReconcileCountersJob` +
`NormalizePositionsJob` · `OverdueDigestJob` email · Lists and List-detail screens from the
mockup's product-card and table components · dashboard stats.
*Limits are **not** enforced yet — that lands with M4, so quota code is written once, against a
real plan.*

**M4 — Billing**
`PaymentProvider` interface · `CreemProvider` · `config/plans.ts` + `PlanService` ·
checkout/return/portal · webhook endpoint + `webhook_events` ledger + `ProcessWebhookJob` ·
subscriptions/payments tables · entitlement gating in controllers and Edge · dunning emails ·
`billing:sync` + `billing:replay` · **quota enforcement (§7.4): `lists`, `todosPerList`, `seats`
guards with row locking, `402` API shape, usage meters, at-cap upsells, `limit_overrides`** ·
the §15 quota suite.

**M5 — Storage**
Drive config (fs/r2) · `FileService` · upload with validation and quota · signed URLs ·
avatars/logos · soft delete + purge job · Alpine upload component.

**M6 — Organisation API**
`api_keys` + management UI (owner-only) · `ApiKeyAuthMiddleware` · scopes · the §11 lists/todos
endpoints + `GET /organization` headroom endpoint · Transformers · limiter (DB store) ·
`api_requests` + rollup · `402 plan_limit_exceeded` error shape · OpenAPI + `/docs` +
bulk-import guidance.

**M7 — Back-office**
Admin dashboard · org/user search + detail · subscription management · webhook ledger + replay ·
job queue UI · audit log · impersonation with banner and audit · staff management.

**M8 — Hardening & docs**
Rate limits on auth routes · security headers/CSP review · OWASP pass · seeders for every plan
tier · browser tests · README + deployment guide + "how to add a payment/mail/storage provider"
guide · Dockerfile + example compose.

---

## 18. Risks

| Risk | Mitigation |
|---|---|
| One-org-per-user (D1) becomes limiting | §5.4 containment: single scope helper, `owner|member` role vocabulary already pivot-shaped |
| Webhook lost or permanently failed | Idempotency ledger + retry + nightly `billing:sync` drift report + manual replay |
| Out-of-order webhook events | Watermark check + re-fetch from Creem on ambiguity |
| SQLite/Postgres divergence found late | CI runs the full suite on both from M0 |
| DB queue can't keep up | It is behind `QueueService`; swapping in BullMQ later touches one class |
| R2 egress/cost surprise | Private-by-default + short-lived signed URLs + public assets on a Cloudflare custom domain |
| Creem API drift (young platform) | All SDK contact confined to `providers/creem.ts`; fixture-driven tests catch shape changes |
| Staff panel as an attack surface | Separate table + guard (D5), mandatory 2FA, optional IP allowlist, everything audited |
| `todos_count` drifts and quotas silently break | Only ever mutated inside the insert/delete transaction; nightly `ReconcileCountersJob` alerts on drift rather than repairing it; randomised-sequence test in the quota suite |
| Quota bypassed by a race (two parallel creates at cap-1) | Row lock inside the create transaction (§5.5) + an explicit concurrent-request test (§15) |
| Soft-lock (D9) reads as a bug to customers | Usage shown in the nav and on meters *before* the cap is hit; disabled buttons with tooltips; `402` carries `allowed`/`current`/`upgradeUrl` |

---

## 19. Open questions

1. Trial policy — 14-day trial on signup with no card, or free tier only?
2. Organisation deletion — hard delete after a grace period, or soft-delete forever?
3. Are the limit numbers in §7.3 (Free 3 lists / 50 todos / 2 seats · Pro 25 / 500 / 10 ·
   Business ∞ / ∞ / 50) the ones you want, or placeholders to tune once the UI exists?
4. Does the marketing site (landing/pricing/legal) live in this app, or separately?
5. The mockup's **notification dropdown** is fully designed but has no backend here — drop it from
   v1, or add a `notifications` table? (§13.6.5 — decide at M2, don't ship dead UI.)
6. The mockup's **support ticketing** is a full two-pane messaging UI. Confirm v1 ships only a
   contact form that emails support. (§13.6.6)


