# Deploying this application

Two processes, one database, one object store, one mail provider. Nothing here needs Kubernetes,
and nothing here stops you using it.

---

## The shape of it

```
                    ┌──────────────┐
   HTTPS ──────────▶│ web          │  node bin/server.js
                    │ (N replicas) │  stateless; scale horizontally
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐        ┌────────────────┐
                    │ Postgres     │◀───────│ worker         │  node ace queue:work
                    │ jobs + data  │        │ (1+ replicas)  │
                    └──────────────┘        └────────────────┘
                           │                         │
                    ┌──────▼───────┐         ┌───────▼────────┐
                    │ R2 / S3      │         │ Resend         │
                    └──────────────┘         └────────────────┘
```

**The worker is not optional.** Every email, every payment webhook and every scheduled job goes
through the `jobs` table (§9). An application deployed without a worker accepts work it will never
do: signups get no confirmation email, subscriptions never activate, and nothing anywhere reports
an error — the rows simply sit there.

---

## The release

```bash
node ace migration:run --force          # release phase, before the new version serves traffic
node bin/server.js                      # web
node ace queue:work                     # worker
```

Migrations are additive and run before the new code starts, so a rollback does not require a
down-migration. If a change cannot be made that way — dropping a column that the old version still
writes — do it in two releases.

Both processes shut down on `SIGTERM`: the web process stops accepting connections and finishes
what it is serving, the worker finishes the job in its hand and stops claiming new ones. Give them
a grace period of at least 30 seconds, or a long job is killed mid-flight and reclaimed later by
its lease.

---

## The image

`Dockerfile` builds it; `compose.yaml` runs the whole stack locally the way it runs deployed.

```bash
docker compose up --build
docker compose run --rm web node ace migration:run --force
```

The image is multi-stage — the compiler and the dev dependencies never reach the runtime layer —
and runs as the unprivileged `node` user. It contains no configuration: everything comes from the
environment, so the same image is what you promote from staging to production.

One image, two commands:

```bash
docker run … your-image                                # web   (default CMD)
docker run … your-image node ace queue:work            # worker
```

---

## Configuration

`.env.example` is the complete list. The ones that decide whether a deployment is correct rather
than merely running:

| Variable | Set it to | What breaks otherwise |
|---|---|---|
| `APP_KEY` | `node ace generate:key`, kept secret, **never rotated casually** | Rotating it invalidates every session and every signed URL in flight |
| `APP_URL` | the public HTTPS URL | Links in email point at the wrong host |
| `DB_CONNECTION` | `postgres` | SQLite on a container filesystem is a database that disappears on the next deploy |
| `DB_SSL` | `true` for a managed database | Traffic to your database is in the clear |
| `TRUST_PROXY` | `true` **iff** a proxy you control is in front | Every rate limit shares one bucket, and the audit trail records the load balancer |
| `DRIVE_DISK` | `r2` | Uploads land on a container filesystem and vanish with it |
| `MAIL_MAILER` | `resend` | Mail is queued and never delivered |
| `SESSION_DRIVER` | `cookie`, or `database` if you need server-side revocation | — |
| `ADMIN_IP_ALLOWLIST` | your office or VPN ranges | The back-office login is reachable from anywhere (it is still behind a separate guard and mandatory 2FA) |

Secrets are declared with `Env.schema.secret()`, so they cannot be logged or serialised by
accident. Where your platform mounts secrets as files, the `file:` prefix reads them from disk.

---

## Health checks

| Endpoint | Question | Point it at |
|---|---|---|
| `/health` | Is this process alive? | The **restart** probe. It touches nothing else. |
| `/ready` | Can it serve a request? | The **load-balancer** probe. Checks the database and the object store, and answers `503` with which one failed. |

Do not wire a dependency check into the restart probe. A brief database blip then becomes every web
process being killed at once, which turns a blip into an outage.

---

## Behind a proxy

Terminate TLS at the proxy, forward to `PORT`, and set `TRUST_PROXY=true`.

That trusts exactly **one** hop — the peer that connected to us, and so the last address it
recorded — which is the safe reading of a header the client can also send. If you have two proxies
in front (a CDN ahead of a load balancer), one hop is one short and `request.ip()` becomes the load
balancer's address; `config/app.ts` says which line to change, and it has to match your topology
exactly, because every hop trusted beyond the real ones is a hop a client can forge.

HSTS is sent with a 180-day max-age (`config/shield.ts`), so serve HTTPS on the whole domain before
the first request — a browser that receives it will refuse plain HTTP for the domain for that long,
including for anything else you host there.

---

## Backups and retention

- **Postgres**: nightly `pg_dump`, and restore one somewhere before you need to. A backup that has
  never been restored is a hypothesis.
- **Object storage**: enable bucket versioning. Deleted files are soft-deleted for 30 days and then
  hard-deleted by `PurgeDeletedFilesJob` (§10); versioning is what covers the window after that.
- **`webhook_events`** is the billing audit trail. Keep it as long as you keep invoices.
- The scheduled jobs — counter reconciliation, position normalisation, the overdue digest, the
  billing drift report, log pruning — are *dispatched* by `node ace schedule:run`, which takes the
  schedule to run as a flag. Cron calls it; the worker does the work, so a slow task cannot overlap
  its own next run:

  ```cron
  */5 * * * *  cd /app && node ace schedule:run --interval=5m
  0    * * * *  cd /app && node ace schedule:run --interval=hourly
  0 3  * * *   cd /app && node ace schedule:run --interval=daily
  ```

---

## Watching it

Logs are structured JSON on stdout, with a request id on every line. Ship them somewhere
searchable; the id is what makes an error report actionable, because the API hands the same id to
the client when something goes wrong.

Worth alerting on:

| Signal | Query | Why |
|---|---|---|
| Failed jobs | `jobs` where `failed_at` is not null | A failing job is a missing email or an unapplied subscription change |
| Webhook backlog | `webhook_events` where `processed_at` is null and older than a few minutes | Billing is not applying |
| Billing drift | the nightly `billing:sync` report | The provider and this database disagree about who is paying |
| Counter drift | `ReconcileCountersJob` alerts rather than repairing | A quota is being enforced against a number that is wrong |
| `5xx` rate, `/ready` failures | — | The usual |

---

## A checklist for the first deploy

1. `APP_KEY` generated and stored as a secret; `APP_URL` is the public HTTPS URL.
2. `DB_CONNECTION=postgres`, `DB_SSL=true`, migrations run in the release phase.
3. A worker process is running, and it is being restarted the same way the web process is.
4. `node ace schedule:run` is on cron for each interval (see above).
5. `DRIVE_DISK=r2` with a bucket that is **not** public, plus a custom domain for the public disk.
6. `MAIL_MAILER=resend` with a domain verified by SPF and DKIM — until then only
   `onboarding@resend.dev` delivers, and only to yourself.
7. The Creem webhook points at `https://your-app/webhooks/creem`, with a secret that is not the one
   from staging.
8. `TRUST_PROXY` matches reality.
9. `ADMIN_IP_ALLOWLIST` set, and a staff account created with `node ace staff:create` — its
   two-factor enrolment is mandatory.
10. `/health` and `/ready` wired to the right probes.
11. Backups scheduled, and one restored.
12. Read [`security.md`](./security.md) once, with your deployment in front of you.
