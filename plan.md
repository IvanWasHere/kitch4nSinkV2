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
| **D10** | **Registration gate is core, closed only by a registered resolver** (§22.2) | Signup, social sign-in and the Landing CTA all need "is registration open?", and none may import a module. Core asks a one-slot registry that answers *open* when empty, so deleting Registration Control reopens signup instead of leaving a switch nobody can flip back. |
| **D11** | **Runtime settings are a core `site_settings` key/value table with a typed key registry** (§22.3) | Nothing like it exists yet, and env vars cannot change without a deploy. Typed keys keep it from becoming a junk drawer; modules declare theirs the way they declare API scopes. |
| **D12** | **Modules declare audit actions and privacy data by augmentation/registry, never by editing core lists** (§22.4) | `AUDIT_ACTIONS` is a closed const in core today; four modules adding to it would make core name them. Same shape as `#api/scopes`. |
| **D13** | **CMS pages at `/:slug`, matched last; reserved slugs derived from the live route table** (§22.6) | Matches the PRD's URLs and lets an admin publish `/about` without a deploy. Deriving the reserved list from the router means a new core route can never be shadowed and nobody maintains a hand list. |
| **D14** | **A user is never physically deleted: their personal data is overwritten (`deleted.user.<id>@email.com`). Billing is never touched. Lists/todos go only when the user was the workspace's last member. Every deletion needs admin approval.** (§22.8) | Chosen by owner. Keeping the row keeps every FK (todos, tickets, audit logs) valid with no cascade. Billing rows are accounting records. A colleague's shared work (D8) must not vanish because someone else left, but a one-person workspace's lists are only that person's data. |

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
| Support (ticket list + conversation) | `/support` | M10 |
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
5. **The notification dropdown is fully designed but has no backend in this plan.** Decided:
   **build it** — see §20. The `notifications` table lands in M9, the dot goes on the sidebar
   avatar rather than the topbar bell (that is where the request put it), and the dropdown itself
   stays unbuilt so there is one surface and one unread rule (§20.5).
6. **Support tickets are mockup-only.** Decided: **build it** — see §21. The two-pane layout is
   ported and unused; M10 gives it `support_tickets` + `support_messages`, attachments on the
   existing `files` table, and a back-office queue. The contact-form-that-emails-support this
   entry used to propose is superseded: it has no history, no status and nowhere to put a
   screenshot.

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

**M9 — Notifications** *(§20)*
`notifications` + `users.notifications_seen_at` · the audience predicate and its exhaustive tests
(the one cross-tenant surface in the schema) · unread dot on the sidebar avatar · `/notifications` ·
admin-only authoring in the back-office · `PruneNotificationsJob`.
*Ordered after M8 because it is new product surface, not hardening — and because §20.3's predicate
wants the OWASP pass already done around it.*

**M10 — Support tickets** *(§21)*
`support_tickets` + `support_messages` · tenant list/create/conversation reached from the account
menu · back-office two-pane queue with `StaffPolicy.answerSupport` · image attachments on the
existing `files` table, private disk behind an authorising route · reply email · `supportThrottle`.
*Ordered after M9 because it reuses that milestone's mail path and the same back-office shell, and
because M8's rate-limit work is what a public-facing contact surface leans on.*

**M11 — Module seams** *(§22.2–22.4 — core only, no feature)* — **built**
`site_settings` + `SettingsService` (typed keys by augmentation, every change audited) ·
`registrationGate` (open when empty), enforced in `RegistrationService.register()` and before
validation on `POST /signup`, with `RegistrationClosedException` · `AuditActions` augmentation +
core `settings.changed` · modularity test: no module→module imports · docs/modules.md sections.
*Moved out of M11, deliberately:* the new route registration points, `start/privacy.ts` and the
public-id prefixes each arrive with the first module that uses them — the modularity suite
requires every registration point to actually register a module, so an empty one would fail it.
The `privacyData` registry and core's contributors move to M15 with it. The deleted-user-session
fix turned out to exist already (`auth_middleware.ts` signs out a soft-deleted user).

**M12 — Registration control & waiting list** *(§22.5)* — module `registration_control` — **built**.
*In progress.* Built: `registration_enabled` / `waiting_list_double_opt_in` settings and the gate
resolver (`start/settings.ts`, new registration point), `/admin/settings/registration` behind
`StaffPolicy.manageSettings` (admin only), admin-sidebar *Settings* item, audit per changed key.
`start/routes/admin.ts` is now a registration point. **Also built:** the public waiting list —
`waiting_list_entries`, `/waitlist` (closed signup redirects here; open registration redirects
away), double opt-in email with a hashed 48 h single-use link, `/waitlist/confirm/:token`,
per-address and per-mailbox throttles. `start/routes/auth.ts` is now a registration point.
**Also built:** `/admin/waitlist` (support + admin) — status filter pills with counts, 50 per
page, cancel / mark converted / resend link / delete (delete asks first), each audited via the
module's `AuditActions` augmentation. **Also built:** `mark_waiting_list_converted`, daily in
`start/jobs.ts` — pending *and* confirmed entries whose address now has an account become
`converted` (cancelled ones are never overruled), one system audit entry each, idempotent.
**Docs:** `docs/registration-control.md`, including removal steps verified by a drill — with the
module deleted as written there, the suite passed (682, the pre-M12 count) and typecheck was clean.
**M12 done.** Next: M13 (Content CMS) or M14 (Landing).

**M13 — Content CMS** *(§22.6)* — module `content`. Adds `markdown-it`.
*In progress.* Built: `content_entries` + `content_slug_redirects`, `markdown-it@14.3.2`
(`html: false`, scheme allowlist http/https/mailto/relative, `rel=noopener` on external links,
rendered on read), slug rules (generated + disambiguated, reserved from the live route table +
`assets`, unique across types, old slugs of other entries refused), admin CRUD at
`/admin/content/{posts,pages}` behind `StaffPolicy.editPublicSite` (admin only) with
publish/unpublish/archive/delete/preview, all audited; public `/posts` (10/page, id tie-break,
past-last-page 404, numbered pages with `aria-current`), `/posts/:slug`, `/:slug` registered last,
301s for old slugs only to live entries; description/canonical/OpenGraph props on the base layout;
generic `.prose` CSS; *Blog* link in the marketing header. `start/routes.ts` is now a
registration point. **Left for M13:** the `content:check` command (published pages a later route
now shadows), `dev:seed` content, and the docs page + removal drill.

**M14 — Landing** *(§22.7)* — module `landing`; extracts today's `pages/home.edge`.
*Can swap with M13: the reserved-slug check reads the route table, so order does not matter.*

**M15 — Privacy data requests** *(§22.8)* — module `privacy`. Adds a zip writer.
*Last: it is the one that needs every other module's `privacyData` contribution to exist, and the
§19 Q2 / Q7 answers to be in.*

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
| Registration "disabled" but social sign-in or a direct POST still creates accounts | Gate sits in `RegistrationService.register()`, the one call both signup and Ally reach (§22.2); tests hit both paths with the gate closed |
| `/:slug` catch-all shadows a route added later, or a later route silently shadows a published page | Catch-all registered last; reserved set read from the router; a boot-time check logs every published page whose slug is now a route (§22.6) |
| Stored XSS through the CMS | Markdown only, `markdown-it` with `html: false`, link-scheme allowlist; no raw-HTML field exists to misuse; XSS fixtures in the suite |
| Privacy export leaks a secret or another user's data | Each table's contributor is an allowlist of columns, not a `serialize()`; a test asserts no export contains any `*_hash`, `*_secret`, `password`, `recovery_codes` or `access_token` key |
| Privacy deletion half-runs and leaves a user both gone and loggable-in | Contributors are idempotent; the request is only `completed` after all succeed; the user row is anonymised *first*, so a partial run has already revoked access |
| Mail sent to an anonymised `deleted.user.<id>@email.com` address | `email.com` is a real, deliverable domain. `MailerService` refuses any recipient matching `deleted.user.*@email.com` and logs it; covered by a test |

---

## 19. Open questions

1. Trial policy — 14-day trial on signup with no card, or free tier only?
2. Organisation deletion — hard delete after a grace period, or soft-delete forever?
3. Are the limit numbers in §7.3 (Free 3 lists / 50 todos / 2 seats · Pro 25 / 500 / 10 ·
   Business ∞ / ∞ / 50) the ones you want, or placeholders to tune once the UI exists?
4. ~~Does the marketing site (landing/pricing/legal) live in this app, or separately?~~
   **Answered: in this app, as a removable module** — §22.7 (M14). Pricing stays on the billing
   screen; the landing page links to it.
5. ~~The mockup's **notification dropdown** is fully designed but has no backend here — drop it
   from v1, or add a `notifications` table?~~ **Answered: build it.** Staff-authored one-way
   announcements, audience by plan / owners / named users, in M9 — see §20. Its own open questions
   are listed there (§20.9).
6. ~~The mockup's **support ticketing** is a full two-pane messaging UI. Confirm v1 ships only a
   contact form that emails support. (§13.6.6)~~ **Answered: build it.** Two-way tickets with
   image attachments, opened from the account menu and answered in the back-office, in M10 — see
   §21. Three calls are still open inside it and are marked there: who inside a workspace may read
   a ticket (§21.4), whether attachments are exempt from the storage cap (§21.3), and whether
   anything emails staff on a new ticket (§21.7).
7. **Modules PRD (§22)** — the PRD's own §18 list, with a recommendation each. The rest are
   defaults we build unless told otherwise.
   - **a.** ~~Which records are retained vs anonymised?~~ **Answered (D14):** the user row is
     overwritten, never deleted; billing data is never touched; lists and todos go only when the
     user was the workspace's last member. §22.8.4 records the result. Still open inside it:
     audit-log IP/user-agent, and whether the last member's avatar/files go too.
   - **b.** ~~Is deleting a sole owner also workspace deletion?~~ **Partly answered:** if the user
     is the workspace's last member, their lists and todos are deleted. The `organizations` row
     and its billing stay. **Still open:** what happens to an *active subscription* on a
     workspace with no remaining member? It keeps billing unless somebody cancels it. Suggestion:
     the approving admin sees a warning and cancels it by hand from the existing subscription
     screen, which leaves "billing is never touched" true for the deletion job itself.
   - **c.** ~~Admin approval for every deletion?~~ **Answered: yes, every deletion.** There is no
     automatic path.
   - **d.** Double opt-in default on → **yes**.
   - **e.** Waiting list informational only → **yes**; no invite/convert flow beyond "mark
     converted" and a nightly auto-match (§22.5).
   - **f.** Post URL `/posts/:slug`, page URL `/:slug` → **yes** (D13).
   - **g.** Editor → **textarea + Markdown**.
   - **h.** Old slugs redirect → **yes**, 301 via `content_slug_redirects`.
   - **i.** Legal pages shipped → **privacy + terms** only.
   - **j.** Export includes file **contents** → **no, metadata only** in v1; files are workspace-
     owned (D8) and a user's export is not the way to bulk-download a workspace.
   - **k.** 48 h export retention → **yes**, as a typed setting.
   - **l.** Role split → §22.9's table.

---

## 20. Notifications (M9)

Closes §19 Q5 with **build it**. The mockup's notification UI has been dead CSS since M0
(`.notif-menu`, `.notif-item`, `.notif-icon-wrap`, the `dropdown` Alpine component); this gives it
a backend.

### 20.1 What this is, and what it is not

**Is:** one-way, in-app announcements written by staff and shown to a chosen slice of tenant users.
"We are raising the Pro list limit." "Maintenance on Sunday." "Your workspace has been given extra
seats."

**Is not:**

- **Not transactional.** Nothing in the application emits one. A payment receipt is an email
  (§8); a quota block is a 402 and an inline upsell (§7.4). If a *feature* wants to tell one user
  something, that is a different mechanism, and mixing the two is how an announcements table
  becomes an event log with a million rows.
- **Not two-way.** No replies, no read-and-respond. Support conversations are §21.
- **Not email.** In-app only. Adding email later means `MailerService` plus a job and an
  unsubscribe preference — a decision with its own consequences, deliberately not bundled here.

That volume assumption — **tens of rows a year, not millions** — is what makes the design below
correct. §20.4 says where it stops being correct.

### 20.2 Data model

**`notifications`** — staff-authored, and the one table in the schema that is deliberately **not**
tenant-owned.

`id`, `public_id` (`ntf_…`), `title`, `body`, `level` (`info|success|warning|error`),
`audience_type` (`all|plan|owners|users`), `audience` (json, nullable),
`action_label` / `action_url` (nullable — an optional single CTA),
`published_at` (nullable — null is a draft), `expires_at` (nullable — null is forever),
`created_by_staff_id`, timestamps, `deleted_at`

- `level` maps onto the four `.notif-icon-wrap` variants already ported. No new CSS.
- **No `organization_id`.** A notification crosses tenants by design, which is exactly why §20.3
  exists.
- Deletion is soft, like files and lists: it vanishes from users immediately and is recoverable.

**`users.notifications_seen_at`** (timestamp, nullable) — one added column, and the whole of the
unread mechanism. See §20.4.

### 20.3 Audience — the one cross-tenant surface

`audience_type` + an `audience` json payload, rather than five booleans:

| `audience_type` | `audience` | Means |
|---|---|---|
| `all` | — | every tenant user |
| `plan` | `{ planKeys: ['pro','business'] }` | users whose organisation is on one of these plans |
| `owners` | `{ planKeys?: [...] }` | owners only, optionally narrowed by plan |
| `users` | `{ userIds: [12, 44] }` | one user, or a named group |

The whole rule is **one pure predicate**, `appliesTo(notification, user, organization)`, over values
already on the context — `user.role`, `user.id` and `organization.planKey`, which
`require_organization` has loaded anyway. No query, no network, the same shape as
`PlanService.can()`.

> **This is the only place in the application where a query does not filter on
> `organization_id`.** Every other table is tenant-owned and §5.4's rule holds; here, crossing
> tenants *is* the feature. A bug in that predicate shows one customer another customer's
> announcement, and a `users`-targeted notification is the sharpest edge — so it gets exhaustive
> unit tests and its own cases in `tests/functional/tenant_isolation.spec.ts` (§20.7).

`userIds` holds internal ids, not public ids: they never leave the process, and the admin screen
resolves people through the existing user search (§12).

### 20.4 Unread state: one column, not a join table

**`users.notifications_seen_at`**, not a `notification_reads` table.

The dot is: *does any notification that applies to me have `published_at` later than my
`notifications_seen_at`?* Opening the page stamps the column. One integer column, no join, no row
per user per notification.

Reading `notifications_seen_at` **before** stamping it also gives "new since your last visit"
highlighting on the page for free.

The predicate cannot be pushed into SQL — matching `planKeys` or `userIds` needs JSON operators,
which portability rule 5 forbids. So the query fetches candidates (published, unexpired, newer
than `seen_at`, `LIMIT 50`) and filters them in memory. For an active user that is **0–3 rows**;
for somebody who has never looked it is every announcement ever published, which the volume
assumption keeps to tens.

**When this design stops being right.** If notifications ever become per-event — one per completed
job, one per assigned todo — the candidate set is no longer bounded and the in-memory filter
becomes a table scan on every page load. The upgrade is then a `notification_recipients` table
written at publish time, which trades a fan-out write for an indexed unread count. Do not make
that change until the volume forces it, and do not quietly start emitting per-event rows into this
table instead.

Per-item dismiss, or "which users read which announcement", also needs the receipts table. Neither
is in v1.

### 20.5 Screens

**Tenant — the dot.** On the sidebar avatar (`.sidebar-user`), not the mockup's topbar bell: the
request is that the dot lives on the user's profile and leads to a page. `.notif-dot` is the only
new CSS (six lines, and the mockup already specifies it). The whole footer becomes a link to
`/notifications`. Rendered from what `require_organization` already shares, so no controller has
to remember to fetch it.

**Tenant — `/notifications`.** A list, newest first, using `.notif-item` / `.notif-icon-wrap`
unchanged. Items published since the previous `seen_at` are marked new. Visiting stamps the column,
which clears the dot. Every member sees it; there is nothing owner-only about being told something.

**Back-office — `/admin/notifications`.** Index (draft / published / expired), a create form with
a live "this will reach N people" count, and delete. The audience picker is four radio options
matching §20.3, with a plan multi-select and — for `users` — the existing admin user search.

The mockup's **dropdown** is left unbuilt. Its CSS stays ported and the page is the single surface;
adding the dropdown later is a partial that reuses the same query. Two surfaces for one feature is
two places for the unread rule to disagree.

### 20.6 Authorisation

Creating a notification is a broadcast to customers, so it sits with the actions that change what a
customer experiences: **admin only**, via `StaffPolicy.manageNotifications`. Support can read the
list — it needs to answer "did they get told?" — but cannot write one. That is the same
support/admin line §6 draws for plan overrides.

On the tenant side there is no policy: a notification is either in your audience or it does not
exist for you, and that is the predicate's job, not a policy's.

### 20.7 Tests

- **Unit — the predicate, exhaustively.** Every `audience_type` × owner/member × each plan ×
  targeted/not-targeted. This is the file that stops a cross-tenant leak, so it enumerates rather
  than spot-checks (the shape `tests/unit/plan_service.spec.ts` already uses).
- **Unit — unread.** A draft never counts. An expired one never counts. One published before
  `seen_at` never counts. A soft-deleted one never counts.
- **Functional — the flow.** Dot appears → page lists it → dot clears → a second notification
  brings it back. Visiting stamps once, and "new" highlighting uses the *previous* value.
- **Tenant isolation** — new cases: a `users`-targeted notification is invisible to everyone else;
  a `plan`-targeted one is invisible to an organisation on another plan; an owners-only one is
  invisible to members.
- **Functional — back-office.** Support can list but not create or delete; admin can do both;
  every create and delete writes an audit entry (§12).

### 20.8 Build order

1. Migration for `notifications`, migration adding `users.notifications_seen_at`, `schema_rules`
   entries, models, `ntf_` prefix in `public_id.ts`.
2. `app/notifications/audience.ts` — the predicate, and its unit tests. **Before any UI.**
3. `app/notifications/notification_service.ts` — unread count, feed, stamp, create, delete.
4. Share the count in `require_organization`; `.notif-dot` on the sidebar; `/notifications`.
5. Back-office screens, `StaffPolicy.manageNotifications`, audit actions.
6. `PruneNotificationsJob` — hard-deletes soft-deleted rows past 30 days, matching
   `PurgeDeletedFilesJob`.
7. Update §13.6.5 and §19 Q5; add the feature to `CONTRIBUTING.md`.

### 20.9 Deliberately not in v1

- **Organisation-targeted notifications** (`audience_type: 'organization'`). Obviously useful for
  support — "tell this one customer" — and a one-line addition to §20.3 whenever it is wanted.
  Left out only because it was not asked for.
- Email delivery, per-item dismiss, read analytics, scheduling beyond `published_at`, and the
  dropdown surface. Each is listed above with what it would cost.

---

## 21. Support tickets (M10)

Closes §19 Q6 with **build it**. The mockup's two-pane support UI has been dead CSS since M0
(`.support-layout`, `.ticket-list`, `.ticket-item`, `.conversation-panel`, `.msg`, `.reply-area`,
`.new-ticket-card` — ported in full, used by nothing); this gives it a backend. §13.6.6's
"ship a contact form that emails support" is superseded: a form that emails support has no
history, no status and nowhere to put a screenshot, which is most of what somebody opening a
ticket came for.

### 21.1 What this is, and what it is not

**Is:** a two-way conversation between one workspace and staff, in the application, with
attachments. A customer opens a ticket, sees every ticket they have opened before, and reads the
reply where they asked the question.

**Is not:**

- **Not a helpdesk.** No SLAs, no queues, no macros, no CSAT, no email ingestion, no tags. If the
  business needs those, this is the wrong table and Zendesk is a webhook away — but a boilerplate
  that cannot answer "where do customers reach us" is missing a floor, not a ceiling.
- **Not per-user chat.** A ticket belongs to an **organisation** (§5.4), like every other
  tenant-owned row. Who inside it may read the ticket is §21.4, and that is a narrower question
  than which tenant owns it.
- **Not the announcements feed (§20).** That is one-way, staff-authored, cross-tenant and
  non-transactional. This is two-way, customer-initiated and tenant-owned. They share nothing but
  the word "message", and merging them would put a million-row event log in the table §20.4's
  unread mechanism depends on staying small.
- **Not email-in.** We send a notification with a link; replying to that email does nothing.
  Inbound parsing means a provider webhook, MIME decoding, and a spam surface with a database
  write behind it. Left out on purpose, and §21.11 says what it would cost.

Volume assumption: **hundreds of tickets a year, tens of messages each.** Both tables are ordinary
indexed tenant tables, so unlike §20 there is no clever mechanism resting on that number.

### 21.2 Data model

**`support_tickets`** — tenant-owned, `organization_id` on every query (§5.4).

`id`, `public_id` (`tkt_…`), `organization_id`, `created_by_user_id`, `subject`,
`status` (`open|answered|resolved`), `last_message_at`, `first_responded_at` (nullable),
`assigned_staff_id` (nullable), `resolved_at` (nullable), timestamps, `deleted_at`

**`support_messages`**

`id`, `public_id` (`msg_…`), `support_ticket_id`, `author_type` (`user|staff`),
`author_user_id` (nullable), `author_staff_id` (nullable), `body`, `created_at`

- **Two nullable author columns, not one polymorphic id.** Tenant users and staff are separate
  tables behind separate guards (D5); a single `author_id` would need the type to be read before
  the row means anything, and a foreign key to nowhere. Exactly one is set, enforced in the
  service and asserted in tests.
- `first_responded_at` is the only reporting-shaped column here, and it is worth the byte: "how
  long until somebody answered" is the one support number anybody ever asks for.
- `last_message_at` is denormalised so the list sorts and pages without touching the messages
  table. It is written in the same transaction as the message.
- Deletion is soft, like files and lists. Deleting a workspace soft-deletes its tickets with
  everything else (§5.7) — a ticket outliving its workspace is an orphan holding customer data.

**Three statuses, and the reopen rule.**

| From | Event | To |
|---|---|---|
| — | customer opens a ticket | `open` |
| `open` | staff replies | `answered` |
| `answered` | customer replies | `open` |
| `open` / `answered` | staff resolves | `resolved` |
| `resolved` | either replies | `open` |

`open` means *waiting on us*, `answered` means *waiting on them*, and that is the whole state
machine. There is no `closed`: a resolved ticket somebody replies to is open again, because that
is what people do instead of opening a second ticket about the same thing. No status lives on a
message — a conversation has one state and it is the ticket's.

### 21.3 Attachments

Reuse **`files`**, which is already polymorphic (`attachable_type`, `attachable_id`) and already
does checksum, real content sniffing and the storage quota. The only change is widening
`UploadInput.attachTo.type` in `app/storage/contracts.ts` from `'User' | 'Organization'` to
include `'SupportMessage'`.

- **Private disk, always.** A screenshot attached to a support ticket is the likeliest place in
  the product for a customer to paste something they would not publish. It is served by a route
  that authorises against the ticket first and *then* issues a short-TTL signed URL through the
  existing `DiskStorage.urlFor()` — never a public URL, and never a signed URL minted before the
  check.
- **Caps:** three files per message, 5 MB each, images and PDF only. The sniffing layer already
  refuses an HTML document wearing a `.png` extension (§10), which is the attack this feature
  invites.
- **The quota trap.** Attachments are recorded against the workspace's storage like any other
  file, but are **exempt from the cap check**: otherwise a customer at their storage limit cannot
  attach a screenshot to the ticket they are opening *about being at their storage limit*. The
  bytes still count toward what the meter displays, so the number stays honest; only the refusal
  is skipped. If that ever gets abused, the answer is a per-workspace attachment budget, not
  re-arming the cap.

### 21.4 Who inside a workspace can read a ticket

**The author, plus owners.** Not workspace-wide.

Lists and todos are workspace-wide by D8 because they are the shared work. A support ticket is
not: it can carry a billing dispute, a complaint about a teammate, or a screenshot of something
personal. Owners are included because they are already the billing and membership authority and
will be answering for the workspace anyway.

The alternative — every member sees every ticket, matching D8 — is one predicate in
`SupportService.scopeFor(user)` and a different set of tests. It is a product call, not an
architectural one, and reversing it later costs an afternoon.

### 21.5 Screens

**Entry point: the account menu.** A `Support` row with the `lifebuoy` icon in the header's
account menu (`layouts/app.edge`), above the divider that separates *Sign out*. That is where the
request put it, and it is one surface on desktop and mobile because that menu already is.

**Tenant**

| Route | Screen |
|---|---|
| `GET /support` | ticket list — `.ticket-list` + `.ticket-item`, `empty_state` when there are none |
| `GET /support/new` | `.new-ticket-card` + the existing `file_drop` component |
| `POST /support` | create |
| `GET /support/:id` | conversation — `.conversation-panel`, one `.msg` per message |
| `POST /support/:id/messages` | reply |
| `GET /support/:id/files/:fileId` | authorise, then redirect to a signed URL |

**Back-office — `/admin/support`.** The mockup's two-pane layout as designed: `.ticket-list` on
the left filtered by status (`open` first, because that is the queue), `.conversation-panel` on
the right with `.reply-area` under it. Staff can reply, resolve, and assign to themselves. The
list is cross-tenant — that is the job — and every row shows which workspace it came from, linking
to the org detail screen (§12).

Plain form POSTs, no Alpine required (§13.3). The reply box is a textarea and a button; the
`autoGrow` component already ported is sugar on top of it.

### 21.6 Authorisation

- **Staff:** a new `StaffPolicy.answerSupport` — `!staff.isDisabled`, so **support and admin
  both**. Answering tickets is the support role's entire reason to exist; this is the one
  back-office surface where the §6 support/admin split does *not* narrow to admin.
- **Tenant:** no policy. §21.4's scope decides whether a ticket exists for you, the same way
  §20.6 leaves the audience predicate to decide.
- **Impersonation is already handled.** `app/middleware/impersonation.ts` refuses every non-GET
  request for a non-admin staff session, so a support member impersonating a customer cannot open
  or reply to a ticket as them. No new code, and a test that says so.

### 21.7 Telling people there is a reply

**Email on staff reply.** A `SupportReplyNotification` mail class plus `emails/support_reply.edge`
and its `_text` twin, queued through `MailerService` like every other mail (§8). It carries the
reply and a link — it is a notification, not a thread; §21.1 says why.

**No new dot, and no new column.** Unread is *derived from status*: a ticket in `answered` is one
staff has replied to and the customer has not answered. The count on the account menu's `Support`
row is the number of those in scope. Replying flips it to `open` and it drops out of the count.
That is one indexed query with no `seen_at` column, no join table, and no second definition of
"unread" to disagree with §20.4's.

**Nothing emails staff.** The back-office list filtered to `open` is the queue, and it is pulled,
not pushed. A digest to `SUPPORT_EMAIL` is a job and four lines whenever somebody actually wants
to be interrupted.

### 21.8 Abuse, audit, retention

- **Rate limits** (§14): `supportThrottle` beside the seven already in `start/limiter.ts` — five
  tickets an hour and thirty messages an hour per user. A contact surface without a limiter is a
  spam target with a database behind it.
- **Validation:** subject ≤ 150 chars, body ≤ 5 000, in `app/validators/support.ts`.
- **Audit (§12):** `support.ticket.created` as a user action; `support.message.created`,
  `support.ticket.resolved` and `support.ticket.assigned` as staff actions. Staff reading and
  writing customer data is already the audited category.
- **Retention:** tickets follow the workspace. `PurgeDeletedFilesJob` already hard-deletes
  soft-deleted files past 30 days; attachments inherit that unchanged.

### 21.9 Tests

- **Tenant isolation — the test that matters.** A member of workspace A gets a 404 on workspace
  B's ticket, on its message endpoint, and on its attachment URL. New cases in
  `tests/functional/tenant_isolation.spec.ts` (§20.7 added its own there for the same reason).
- **Scope inside a workspace.** A member sees their own tickets and not a colleague's; an owner
  sees both. Whichever way §21.4 lands, this file is where it is written down.
- **Status machine.** Every transition in §21.2's table, including reopen-by-reply, and
  `first_responded_at` being stamped once and never moved.
- **Staff.** Support can reply and resolve; a disabled staff account cannot; a tenant user gets
  nothing from `/admin/support`; impersonating support cannot post a message.
- **Attachments.** A `.png` that is really HTML is refused (the existing fixture); over-size is
  refused; a signed URL for one tenant's attachment does not work for another; the storage cap
  does not block an attachment but does count its bytes.
- **Rate limit.** The sixth ticket in an hour is a 429, not a row.
- **Browser (§15).** Create a ticket with an image, staff replies, customer sees it. Multipart is
  already the documented reason browser tests exist here.

### 21.10 Build order

Four slices, each shippable on its own.

1. **Schema and the tenant slice.** Migrations for both tables, `schema_rules` entries, models,
   `tkt_`/`msg_` prefixes in `public_id.ts`, `SupportService` (scope, create, reply, transitions),
   `/support` list + new + show. No attachments, no staff side. A customer can ask a question and
   read the thread.
2. **Back-office.** `/admin/support` two-pane, reply, resolve, assign, `answerSupport` policy,
   audit actions. Now somebody can answer.
3. **Attachments.** Widen `attachTo`, the authorising download route, the caps and the quota
   exemption, and their tests.
4. **Polish.** `SupportReplyNotification` + templates, the `answered` count on the account menu,
   `dev:seed` fixtures (one open ticket with an image, one answered, one resolved), a styleguide
   entry, README and CONTRIBUTING, screenshots.

Then update §13.5's table row, §13.6.6, and §19 Q6 — done in the same commit as this section.

### 21.11 Deliberately not in v1

- **Email-in.** Replying to the notification email should append to the ticket. It needs an
  inbound webhook from the mail provider, MIME and quoted-reply parsing, and a spam gate on a
  route that writes to the database. Worth doing the day support actually lives in email, and not
  before.
- **Internal staff notes** — a `is_internal` flag on a message, hidden from the customer. One
  column and one `where`, deliberately deferred: the first time it is rendered on the wrong side
  of the pane, a customer reads what staff said about them.
- **Assignment beyond "assign to me"**, queues, SLA timers, canned replies, CSAT, tags, search
  across tickets, and per-ticket read receipts.
- **A ticket opened from a specific context** — "help with this failed payment" prefilled from
  the billing screen. Cheap once the tables exist, and genuinely useful; it is not in slice 1
  because the plumbing has to work first.

---

## 22. Registration control, Content, Landing & Privacy (M11–M15)

Source: *PRD — Admin Content, Registration Control, Landing Pages & Privacy Modules* (proposed).
This section is that PRD checked against the code as it stands, not restated. Where the PRD says
"confirm X" or "if the repository already has Y", the answer is written down here; where it is
silent about something the code makes unavoidable, that is called out as **Gap**.

### 22.1 Verdict on the PRD

Sound in intent, and its central rule — *modules use core, core never depends on a module* — is
already this codebase's rule, enforced by `tests/unit/modularity.spec.ts`. What it gets wrong or
leaves open is almost entirely about **seams**: the PRD assumes integration points that do not
exist yet.

| PRD assumes | Reality | Consequence |
|---|---|---|
| "Add or reuse the existing settings abstraction" | There is none. No `settings` table, no service. | New core piece (D11, §22.3). |
| Modules register routes "at an explicit integration point" | Only `start/routes/web.ts` and `api.ts` are registration points, and both are the *tenant/API* stacks. Nothing covers guest/auth, public, or admin routes. | Three new registration points (§22.4). |
| "Use the existing audit infrastructure" | `AUDIT_ACTIONS` in `app/audit/audit_service.ts` is a closed const in core. | Modules cannot add actions without editing core → augmentation (D12). |
| "Server must enforce the setting at the account-creation boundary" | There are **three** creation paths: `/signup`, Ally social sign-in (`social_auth_controller.ts:103`), and invitation accept (`invitation_service.ts:174`, which calls `User.create` directly). | **Gap.** The PRD names only the first. §22.2 decides each. |
| `/` "falls back to the existing authentication/signup entry point" | `/` is `router.on('/').render('pages/home')` in core `start/routes.ts`, rendering a core marketing page. There is no other entry point to fall back to. | Landing is an *extraction*, and the fallback has to be defined (§22.7). |
| CMS pages at `/privacy`, `/terms` **and** Landing owns `/privacy`, `/terms` | Both PRD sections claim the same paths. | **Gap.** Resolved by D13's route-table reservation (§22.6). |
| "A user whose deletion is complete must no longer be able to authenticate" | Password sign-in rejects soft-deleted users (`User.verifyActiveCredentials`) and `auth_middleware.ts` ends an open session on the next request. | Already covered; M15 only has to set `deleted_at`. |
| Deletion "where technically appropriate" | One org per user (D1); the owner cannot leave (`MembershipService.leave`); org deletion is soft and §19 Q2 is still open. | Settled by D14: overwrite the user, never touch billing, delete lists/todos only for the last member. Only the orphaned active subscription is still open (Q7b). |
| Export "includes user-owned content" | That content lives in `app/modules/lists` (and core support/files). A privacy module that queries it imports another module. | **Gap.** `privacyData` registry (§22.4). |
| Markdown "rendered safely" | No Markdown or sanitiser dependency installed. | Add `markdown-it` (§22.6). |
| Export as `export.zip` | No zip dependency installed. | Add one (`yazl` — small, streaming, no native code). |

Things the PRD asks for that already exist and need **no** work: admin nav is already
`hasRoute`-guarded (`layouts/admin.edge`), so module admin screens appear and vanish by route;
`StaffPolicy` already draws the support/admin line; private disk + authorise-then-sign download is
the support-attachment pattern (§21.3); limiter DB store, durable queue, `MailerService`, seeder
and job registries all exist.

Module names: `registration_control`, `content`, `landing`, `privacy` under `app/modules/`, as
the PRD suggests and docs/modules.md prescribes. Migrations stay in `database/migrations/` (Lucid
records them by path — docs/modules.md explains why they cannot live in the module). Views stay in
`resources/views/pages/<module>/` and emails in `resources/views/emails/`, same reason.

### 22.2 The registration gate (D10)

**Where it sits.** `RegistrationService.register()` — the single function `/signup` and Ally both
call. A check in the controller would leave social sign-in open; a check in middleware would leave
the service callable from anywhere else that grows later.

```ts
// app/auth/registration_gate.ts — core
export const registrationGate = {
  resolver: null as null | (() => Promise<boolean>),
  use(resolver: () => Promise<boolean>) { this.resolver = resolver },
  async isOpen() { return this.resolver ? this.resolver() : true },
}
```

Registration Control registers the resolver (reading `registration_enabled` from settings). Remove
the module and the slot is empty → open. That is the whole of the PRD's
`RegistrationAvailabilityService`, and Landing reads the same object.

**Per path, when closed:**

| Path | Behaviour |
|---|---|
| `GET /signup` | Redirect to `waitlist.create` if that route exists, else render the core signup page's "registration is closed" state. Core names the route only through `hasRoute`. |
| `POST /signup` | `RegistrationClosedError` from the service → same redirect, nothing written. Logged as `registration.blocked`. |
| Ally, **new** identity | Same error → waitlist with the provider email prefilled. Existing identities sign in as normal — that is login, not registration. |
| Invitation accept | **Not gated.** An owner adding a colleague to a paying workspace is not public registration, and seats already gate it. Stated in the admin settings copy so nobody is surprised. |
| Staff creating staff | Not gated; different table (D5). |

Login, password reset, verification, 2FA and every existing session are untouched — the gate is
consulted in exactly one function.

### 22.3 Runtime settings (D11)

**`site_settings`** — `key` (unique string), `value` (json), `updated_by_staff_id` (nullable),
`updated_at`. One row per key, absent row = default.

`SettingsService.get(key)` / `set(key, value, staff)`; keys are a declaration-merged
`interface SiteSettings { registration_enabled: boolean; … }` with a default per key, so a typo is a
compile error and `get` is typed. Every `set` writes an audit entry (`settings.changed`, with key,
old and new value).

No cache in v1: web and worker are separate processes (§16), so a per-process cache needs
invalidation, and one indexed primary-key read per signup is nothing. Revisit if a setting lands on
a hot path.

Keys this PRD adds: `registration_enabled` (default `true`), `waiting_list_double_opt_in`
(`true`), `privacy_export_ttl_hours` (`48`).

### 22.4 Seams core gains in M11

Each one is a registry or a registration point, so each module's removal is still deletions only —
docs/modules.md's promise.

1. **Route registration points.** Add `start/routes.ts` (public: landing, posts, pages),
   `start/routes/auth.ts` (guest group: waitlist), `start/routes/admin.ts` (staff group: settings,
   waitlist admin, content admin, privacy admin) to `REGISTRATION_POINTS`. Modules export
   `registerXxxRoutes()` functions called *inside* core's groups, exactly as lists does, so they
   inherit `staffAuth`, `adminIpAllowlist`, guest and throttle middleware.
2. **`AuditActions` augmentation.** Turn `AUDIT_ACTIONS` into the core half of an
   `interface AuditActions`; modules `declare module '#audit/audit_service'` and add theirs. The
   audit-log filter screen reads the union. Removing a module removes its actions from the type, so
   a stray `audit.record('content.published')` fails to compile.
3. **`privacyData` registry.** `privacyData.register({ key, label, export(user), erase(user, trx),
   retained: string })`. Core registers its own contributors (profile, social accounts, auth
   tokens, files metadata, support messages, notifications seen-at, audit entries about the user);
   modules register theirs in a new registration point, `start/privacy.ts` (lists adds one block
   there; Registration Control adds its waitlist contributor). Privacy iterates the registry and
   names no table. A test asserts every model with a `user_id`-shaped column is either covered by a
   contributor or listed in an explicit `NOT_PERSONAL` allowlist with a reason — the same
   "exhaustive, not spot-checked" shape as `tests/unit/jobs.spec.ts`.
4. **Deleted-user sessions.** *Already handled* — `app/middleware/auth_middleware.ts` signs out
   a soft-deleted user on their next request. No work needed.
5. **Modularity test.** The new points above, plus a new assertion: **no `#modules/a` import from
   inside `app/modules/b`.** Landing reaches registration state through `registrationGate`, Privacy
   reaches lists through `privacyData`; neither may shortcut.
6. **Public-id prefixes** in `app/models/public_id.ts`: `wle_` (waiting list), `cnt_` (content),
   `prq_` (privacy request). Core file by design (docs/modules.md step 3).

### 22.5 Registration Control & waiting list (M12)

**`waiting_list_entries`** — `id`, `public_id`, `email` (lowercased, **unique**), `status`
(`pending_confirmation|confirmed|converted|cancelled`), `double_opt_in_required` (bool, snapshot),
`confirmation_token_hash`, `confirmation_expires_at`, `confirmed_at`, `converted_at`,
timestamps. *(No `ip` column as built — nothing reads it, and it is personal data to delete later.)*

PRD's `invited` state is dropped (Q7e): with no invite flow there is nothing to put an entry in it.

- **Enumeration.** Submit always answers "If this email can be added to the waiting list, we will
  send further instructions." whether the address is new, already queued, or already an account.
  An existing-account address gets *no* email (sending "you already have an account" is itself the
  leak — the forgot-password page is where they go). *As built,* the work runs inline rather
  than in a job: the mail itself is already queued by `MailerService`, so the remaining timing
  difference is one indexed lookup. Move it to a job if that ever matters.
- **Tokens.** 32 random bytes, sha256 stored, 48 h expiry, single-use — the `auth_tokens` recipe
  (§5.2), reused as a helper, not a new scheme. Outcomes: confirmed / already confirmed / expired
  (with a "send again" form) / invalid, none of which echo the address.
- **Setting changes are forward-only.** `double_opt_in_required` is snapshotted per row; flipping
  the setting touches no existing row (tested).
- **Conversion.** `MarkWaitlistConvertedJob`, nightly, in the module: confirmed entries whose email
  now exists in `users` become `converted`. Keeps core's registration path ignorant of the list.
  Admin can also mark by hand.
- **Throttle.** `waitlistThrottle` — 5 submissions/hour per IP and 3 per address/day;
  confirmation link 20/hour per IP.
- **Routes.** Guest: `GET/POST /waitlist`, `GET /waitlist/confirm/:token`. Admin:
  `/admin/settings/registration`, `/admin/waitlist` (filters per PRD; actions view, cancel, delete,
  mark converted, resend confirmation).
- **Audit:** `settings.changed`, `waitlist.cancelled|deleted|converted|resent` (staff actions);
  creation/confirmation are logged, not audited — they are anonymous public events and would flood
  the audit screen.
- **Removal:** reset `registration_enabled` row is unnecessary (D10 reopens signup); drop the table
  by a new migration on existing installs.

### 22.6 Content CMS (M13)

**`content_entries`** — `id`, `public_id`, `type` (`post|page`), `title`, `slug` (**unique across
both types**), `excerpt`, `body` (Markdown source), `status` (`draft|published|archived`),
`published_at`, `created_by_staff_id`, `updated_by_staff_id`, timestamps — index(`type`,
`status`, `published_at`). Naming follows `notifications.created_by_staff_id`, not the PRD's
`created_by_staff_user_id`.

**`content_slug_redirects`** — `old_slug` (unique), `content_entry_id`, `created_at`. Written when a
published entry's slug changes; `/posts/:old` and `/:old` 301 to the current URL (Q7h).

**Lifecycle.** Publish sets `published_at` only if null (re-publishing keeps the original date);
unpublish → `draft`, keeps `published_at`; archive → `archived`. A future `published_at` is a
scheduled post — public queries are `status = published AND published_at <= now`, so scheduling
costs nothing and needs no job.

**Listing.** `GET /posts` — Lucid `paginate(page, 10)`, ordered `published_at desc, id desc`
(the tie-breaker the PRD asks for). Out-of-range page → 404, not an empty page. Pagination
component gets `aria-current="page"`.

**Routing (D13).** `/posts`, `/posts/:slug`, then `/:slug` registered **last** in `start/routes.ts`
with a `^[a-z0-9]+(?:-[a-z0-9]+)*$` matcher. Reserved slugs are computed from `router.toJSON()` at
validation time: any slug equal to the first segment of a registered route is refused, so `login`,
`admin`, `api`, `posts`, `privacy` (while Landing is installed) are all rejected with no hand-kept
list. If Landing is later removed, `privacy` becomes available to the CMS — which is the right
fallback. A boot-time check (dev and `node ace content:check`) warns about any *published* page
whose slug has since become a route.

**Rendering.** `markdown-it` with `html: false`, `linkify: true`, and `validateLink` limited to
`http`, `https`, `mailto` and relative URLs. Rendered on read, not stored — a renderer fix then
applies to every post. No raw-HTML field exists, so there is nothing to sanitise around. Edge
escapes everything else by default; the rendered body is the single `{{{ }}}` in the module and
carries a comment saying why.

**SEO.** `layouts/marketing` gains optional `description` and `canonical` slots (a core layout
change, generic — not module-aware). Posts use `excerpt` as description; pages use the first 160
chars of rendered text. OpenGraph title/description from the same values.

**Admin.** `/admin/content/posts`, `/admin/content/pages` — list (filters, columns per PRD), form
(textarea + preview tab rendering through the same renderer), publish/unpublish/archive/delete.
Delete is hard (drafts are cheap; published content should be archived) and asks for
confirmation. **Authorisation:** `StaffPolicy.manageContent`, admin only (§22.9).

### 22.7 Landing (M14)

An extraction, not new work: today's `pages/home.edge` becomes `pages/landing/home.edge`, plus
code-defined `privacy.edge` and `terms.edge` (Q7i) with placeholder copy clearly marked
*replace before launch*.

**The `/` handover.** Core keeps the route **name** `home` in both states, because
`layouts/admin.edge`, `layouts/marketing` and emails link to it.

- Module installed: `registerLandingRoutes()` in `start/routes.ts` registers `GET /` as `home`.
- Module removed: core's fallback registers `GET /` as `home` → redirect to `dashboard.index` when
  signed in, else `auth.session.create`.

Core registers the fallback only if no `home` route was registered. **To verify at the start of
M14:** whether the v7 router exposes pending routes before commit (`router.routes` /
`toJSON()`); if not, the fallback moves to a `HomeController` that redirects unless a landing view
has been registered — same behaviour, one more registry.

**CTA.** `registrationGate.isOpen()` → "Create an account"; closed and `hasRoute('waitlist.create')`
→ "Join the waiting list"; closed with no waitlist → sign-in only. Footer links to legal pages via
`hasRoute`. Core's signup page links Terms the same way.

**Assets.** No new Vite entry in v1 — the marketing CSS already exists in core and is generic.
Landing-only styles, if any appear, go in `resources/css/landing.css` with its own entry so they
delete as a file.

**Removal test.** A functional test that boots with the landing registration absent (the test
stubs the registration call) and asserts `/` redirects and `home` resolves. Plus the docs/modules.md
style removal page.

### 22.8 Privacy data requests (M15)

**`privacy_requests`** — `id`, `public_id`, `user_id`, `type` (`export|deletion`), `status`
(`requested|confirmed|approved|processing|completed|failed|rejected|expired`), `requested_at`,
`confirmed_at`, `approved_at`, `started_at`, `completed_at`, `failure_reason`, `rejection_reason`,
`export_key` (private disk), `export_expires_at`, `downloaded_at`, `processed_by_staff_id`,
timestamps — index(`user_id`, `type`, `status`).

**At most one active request per user per type**, enforced in the service inside a transaction
(portability rule 5 forbids the partial unique index that would do it in SQL). A second request
returns the existing one.

#### 22.8.1 Export

`requested → processing → completed → expired`. No confirmation step: asking for your own data is
not destructive.

`GeneratePrivacyExportJob` iterates `privacyData` contributors, writes `data.json` (one key per
contributor), `README.txt` (what each section is, what was excluded and why), zips with `yazl`
to the private disk under `privacy/<public_id>.zip`, sets `export_expires_at = now +
privacy_export_ttl_hours`, queues `PrivacyExportReadyNotification`. Idempotent: a retry overwrites
the same key.

Download: `GET /settings/privacy/exports/:id` — re-authorise (owner of the request, not expired,
completed) **then** redirect to a 5-minute signed URL, the §21.3 pattern. Not via the `files`
table: an export is not workspace storage and must not count against the org's quota.
`PurgePrivacyExportsJob` (hourly, in `start/jobs.ts`) deletes expired objects and marks `expired`.

**Exclusions** (in README and asserted by test): password hashes, 2FA secrets and recovery codes,
`auth_tokens`, social `access_token`, API key hashes (metadata only: name, prefix, created,
last used), session data, other users' personal data (a teammate's name on a shared todo is
exported as their public id, not their name), file contents (Q7j).

#### 22.8.2 Deletion

`requested → confirmed → approved → processing → completed` (or `rejected` / `failed`).

1. **Request screen** explains exactly what §22.8.4 overwrites, deletes and keeps. If the user is
   the workspace's last member, it says plainly that all lists and todos go too.
2. **Confirm** by re-entering the password; social-only accounts (null password) get an emailed
   single-use link instead.
3. **Approve** by an admin. **Every** deletion needs it (D14); there is no auto-processing.
   Reject needs a reason. The approval screen shows whether the user is the workspace's last
   member, and warns if that workspace has an active subscription (Q7b).
4. **`ProcessPrivacyDeletionJob`**, in one transaction where the engine allows:
   **overwrite** the user row first, never delete it — email → `deleted.user.<id>@email.com`
   (`<id>` is the internal integer id, which keeps it unique under the existing unique index),
   `full_name`, `avatar_key`, `password`, 2FA secret, recovery codes and `last_login_at` nulled,
   `deleted_at` set. Even a crash after this point has already revoked access. Then each
   contributor's `erase()` runs. Contributors tolerate rows that are already gone. The request is
   marked `completed` only when all succeed; otherwise it is `failed` with a sanitised reason and
   can be retried.
5. **Last member?** The check runs inside the job's transaction (other non-deleted users in the
   same `organization_id`), not at request time, because members can join or leave while the
   request waits for approval. If there are none, the lists module's contributor deletes the
   workspace's lists and todos. If there are others, lists and todos are not touched.
6. The confirmation email goes to the address captured **before** the overwrite.

Blocker, refused at request time with a clear message: an owner of a workspace that has other
members must transfer ownership first (the existing `owner_cannot_leave` rule). Billing is never
touched by the job. No cancellation, no `PaymentProvider` call.

Impersonating staff can see the privacy screen but **cannot** request, confirm or download — an
explicit policy check, not just the existing non-GET block, because an admin impersonation *can*
POST.

#### 22.8.3 Admin

`/admin/privacy` — list with the PRD's columns and filters, detail with the audit trail for that
request, actions: retry export, approve/reject deletion, retry failed deletion. See §22.9 for who.

#### 22.8.4 Delete / anonymise / retain — against the actual schema

Rules from D14, applied to the actual schema. The rows marked *proposed* are not covered by D14
and still need sign-off.

| Data | Action | Why |
|---|---|---|
| `users` row | **Overwrite, never delete**: email → `deleted.user.<id>@email.com`, personal fields nulled, `deleted_at` set | D14. FKs from todos, tickets, audit logs stay valid |
| `social_accounts`, `auth_tokens` | **Delete** | Pure credentials |
| Avatar file | **Delete** (object + `files` row) — *proposed* | Personal, not workspace work |
| Other files the user uploaded | **Retain**, `user_id` kept as tombstone — *proposed* | Workspace-owned (D8) |
| `todo_lists`, `todos` — **user was the last member** | **Delete** (hard, not soft — a soft-deleted row still holds the data) | D14 |
| `todo_lists`, `todos` — **other members remain** | **Untouched** — not even `assigned_to_user_id` | D14. The overwritten user row already removes the identity |
| `support_tickets` / `support_messages` authored | **Retain**, author anonymised via the user row | Workspace-owned; staff history |
| `api_keys.created_by_user_id` | **Retain** | Org-owned credential; revoking it would break the workspace's integration |
| `invitations` sent by the user | **Delete** pending ones; keep accepted | Pending ones carry a third party's email for no reason |
| `organizations` row | **Untouched**, even when the last member leaves | D14: billing hangs off it |
| `subscriptions`, `payments`, `webhook_events` | **Untouched** | D14: billing data is never touched |
| `audit_logs` (actor or subject) | **Retain**; `ip`, `user_agent` nulled — *proposed* | Security record; network identifiers are not needed to keep it |
| `api_requests` from keys they created | **Retain** (pruned at 30 d anyway) | Org usage |
| `privacy_requests` | **Retain** | Proof the request was honoured |
| Waiting-list entry for the same email | **Delete** | Registration Control registers this contributor |

### 22.9 Permissions

`StaffPolicy` gains: `manageRegistration`, `manageWaitlist`, `manageContent`, `viewPrivacy`,
`processPrivacyExport`, `decidePrivacyDeletion`.

| Capability | Support | Admin |
|---|---|---|
| Change registration settings | | ✓ |
| View / manage waiting list | ✓ | ✓ |
| Manage posts and pages | | ✓ |
| View privacy requests | ✓ | ✓ |
| Retry an export | ✓ | ✓ |
| Approve / reject / retry a deletion | | ✓ |

Support gets the waitlist because it is the same "answer the customer" job as tickets; it gets no
content or deletion rights, matching §6's line that support never changes what a customer sees or
destroys anything.

### 22.10 Tests

Per PRD §8/§13, plus the cases its gaps create:

- **Gate:** closed gate refuses `/signup` POST *and* a new Ally identity; existing Ally identity
  signs in; invitation accept still works; removing the resolver reopens.
- **Enumeration:** identical body and status for new / queued / existing-account addresses.
- **Routing:** every registered route's first segment is refused as a slug (iterates the router,
  so it covers routes added later); `/:slug` never answers for a reserved path; old slug 301s.
- **XSS:** `<script>`, `javascript:` links, `onerror=` in image Markdown, HTML blocks — all inert.
- **Pagination:** 25 posts → pages of 10/10/5, stable under equal `published_at`, page 4 is 404.
- **Privacy inventory:** the exhaustive `user_id`-column test (§22.4.3); no secret-named key in any
  export; user B gets 404 on user A's export id and on its signed URL after expiry.
- **Deletion:** the user row still exists with `deleted.user.<id>@email.com` and no personal
  fields; billing rows are byte-identical before and after; last member → lists and todos gone;
  other members present → lists and todos byte-identical; a member joining between request and
  approval flips the outcome to "untouched"; nothing runs without admin approval; mail to the
  overwritten address is refused; crash injected after the user row → login fails, retry
  completes; second run is a no-op; open session is ended; impersonating admin cannot request.
- **Modularity:** no module→module imports; each module removable — CI job that deletes each
  module folder and its registration lines in turn and runs `typecheck` + the core suite
  (cheap insurance for the PRD's "removing any one module leaves the rest functional").
- Both engines, as always (§15).

### 22.11 Build order inside each milestone

Matches the PRD's phases and PR breakdown, one PR per milestone, each ending green:

- **M11** seams (§22.2–22.4) — one PR, no user-visible change except the deleted-session fix.
- **M12** settings screen → gate resolver → waitlist table/service/tokens → public form →
  confirmation mail → admin list → conversion job → docs.
- **M13** table + redirects → slug/reserved service + tests → renderer + XSS tests → admin CRUD →
  `/posts` → `/:slug` → SEO slots → docs.
- **M14** move home → legal pages → CTA → fallback + removal test → docs.
- **M15** registry contributors (core + lists) and the inventory test **first** → export job,
  download, purge → deletion request/confirm → admin approve → deletion job → docs.

The PRD's "Phase 5 hardening" is not a separate milestone here: each slice carries its own
security tests, and the module-removal CI job (§22.10) is added in M11 so it guards M12–M15 as
they land. Each module ships a docs page in the shape of docs/modules.md and a line in
`CONTRIBUTING.md`.

### 22.12 Deliberately not in v1

From the PRD's non-goals, plus: waiting-list invite/convert flow, CMS navigation menus, RSS,
sitemap, image uploads in posts (would need a public disk path and its own policy), scheduled
deletion auto-processing, export of file contents, and per-module settings screens beyond
registration.
