---
title: Home
nav_order: 1
---

# Multi-tenant SaaS Starter

A working multi-tenant SaaS application, not a scaffold: workspaces with roles and invitations,
plans with limits that are actually enforced, a payment provider behind a webhook, file storage with
quotas, a JSON API with scoped keys, support tickets, announcements, and a staff back office with an
audit trail.

Built on **AdonisJS 6** with Edge templates and Alpine.js, running on SQLite or Postgres from the
same code.

{: .note }
These pages describe how the application behaves and why it is built the way it is. For the
quick-start commands and the environment variable table, see the
[README](https://github.com/IvanWasHere/kitch4nSinkV2#readme). Contributor conventions live in
[CONTRIBUTING.md](https://github.com/IvanWasHere/kitch4nSinkV2/blob/main/CONTRIBUTING.md), and the
original design document is [plan.md](https://github.com/IvanWasHere/kitch4nSinkV2/blob/main/plan.md).

---

## Four kinds of account

Every screenshot on this site is the seeded demo dataset — `node ace db:seed && node ace dev:seed` —
so nothing here is a mock-up.

| | |
|---|---|
| **Workspace owner** — usage meters, billing and API keys | ![Owner dashboard](screenshots/owner-dashboard.jpg) |
| **Workspace member** — no billing, no API keys, and an unread announcement on the bell | ![Member dashboard](screenshots/member-dashboard.jpg) |
| **Staff, admin** — money, growth and everything that needs attention | ![Admin dashboard](screenshots/staff-admin-dashboard.jpg) |
| **Staff, support** — every screen except staff management | ![Support view of organisations](screenshots/staff-support-organisations.jpg) |

The navigation is gated by role, so nobody is offered a screen that would then refuse them.

---

## What is in here

| Page | What it covers |
|---|---|
| [Architecture](architecture.md) | How a request travels, where code lives, and the rules that keep SQLite and Postgres in agreement |
| [Tenancy](tenancy.md) | Workspaces, roles, invitations, and what stops one tenant seeing another |
| [Authentication](authentication.md) | Sign-up, sessions, two-factor, OAuth, tokens and rate limits |
| [Lists and todos](lists-and-todos.md) | The product itself |
| [Files](files.md) | Uploads, type sniffing, quotas and signed URLs |
| [The API](api.md) | Keys, scopes, endpoints, errors and rate limits |
| [Billing and plans](billing-and-plans.md) | Plans, limits, Creem, webhooks and reconciliation |
| [Notifications](notifications.md) | Announcements, audiences and unread state |
| [Support](support.md) | Tickets, from both sides |
| [The back office](back-office.md) | Staff screens, impersonation, operations and the audit log |
| [Development](development.md) | Running it, seeding it, testing it |
| [Deployment](deployment.md) | Putting it somewhere |
| [Security](security.md) | What it defends against, and what it leaves to you |

---

## The ideas it is built on

**A workspace is the unit of everything.** Users, lists, files, keys and tickets all belong to one.
The session names a user, never a workspace, and the workspace is re-derived on every request.

**Plans limit what you create, not what you keep.** Downgrade and everything you already had stays
readable and editable; you simply cannot add more. A failed payment takes nothing away — only a
staff suspension denies access.

**The database is a mirror of the payment provider, never a second opinion.** Only webhooks and
reconciliation write to it, reconciliation corrects only what is safe to correct, and everything
else is reported for a human.

**Two engines, one codebase.** SQLite locally, Postgres deployed, with a set of portability rules
that CI enforces by running the whole suite twice.

**Nothing silently heals.** Counters are updated in the same transaction as the rows they count, and
the nightly sweeps report drift rather than quietly papering over it.
