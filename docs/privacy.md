---
title: Privacy
nav_order: 14
---

# Privacy

People can download a copy of everything this application holds about them, and ask for their
account to be deleted. Every deletion is reviewed by an admin first.

This is a **removable module** — `app/modules/privacy/` — built on a core registry that every
feature reports its personal data to.

---

## Downloading your data

**Settings → Privacy** (`/settings/privacy`), for every member, about themselves only.

1. _Request my data_ queues an export. Asking again while one is being prepared returns that one
   rather than queueing a second. Three requests a day per account.
2. A background job builds a zip and stores it on the **private** disk. The person is emailed
   when it is ready; the email links to the Privacy screen, never to the file.
3. _Download_ goes through a route that checks the export is theirs, finished and not expired,
   and only then redirects to a signed link that lasts **five minutes**. Somebody else's export is
   a 404, not a 403.
4. After **48 hours** (the `privacy_export_ttl_hours` setting) an hourly job deletes the archive and
   marks the request expired. The request row stays as a record.

Generating, downloading, failing and purging are all audited (`privacy.export.*`).

Staff impersonating a customer — admins included — can see the screen but cannot request or
download an export. A copy of somebody's whole account is not something staff get that way.

### In the back office

**Admin → Privacy requests** (`/admin/privacy`), support and admin.

- A list of every request, newest first, with the person, their workspace, type, status and
  dates. Filters for all, exports, deletions, pending, processing, completed and failed, each with
  a count.
- A page per request with its details — size, expiry, whether it was downloaded, why it failed —
  and its history from the audit log.
- **Retry export** on a failed export puts it back in the queue (`privacy.export.retried`). Only a
  failed one, and only while the account still exists. Support can do it as well as admin: the job
  rebuilds over the same storage key, so retrying is harmless.

An export the person asked for has **no download link for staff**: it is only ever handed to them,
signed in.

### Started by staff, on the person's behalf

For a request that arrives by email or ticket, **Admin → Users** has two buttons on every account
that is not already deleted — **admin only** (`StaffPolicy.exportPersonalData`,
`StaffPolicy.eraseAccounts`):

- **Export data** builds the same archive **there and then** — no worker needed; the queued job is
  only a safety net that retries a failed build — for the **admin** to collect: a _Download export_
  button on the request's page hands out a link that lasts five minutes, and each download is
  audited. The person is not emailed and does not see it on their own Privacy screen. It is
  counted separately from their own exports, so neither blocks the other.
- **Delete account** opens a confirmation page showing what would happen, worked out now — last
  member, active subscription, and for an owner who else goes with them. The admin gives a reason (the
  ticket or email it came in on) and types the account's email address; that is the approval, and
  the deletion runs at once under exactly the same rules as below. The person is emailed when it
  is done.

**Admin → Privacy requests** has the export as well: every row whose account still exists has a
**Generate export** item in its three-dot actions menu, admin only, which does exactly what the button on the users screen
does — one click, and the person is not emailed. Once
generated, the item on that person's rows becomes **View report**, a link to the export's page
with its _Download export_ button, until the archive expires.

That page also shows the report itself: the contents of `data.json`, one collapsible section per
feature. Admin only, and every view is audited (`privacy.export.viewed`). It is read from a copy
kept beside the archive (`privacy/<id>.json`, private disk) — only for exports staff started,
never for the person's own — and purged with it. Uploaded files are not shown; they are in the
archive. A report over 1 MB is not rendered, only downloadable.

Both are recorded as started by staff (`requested_by_staff_id`, the reason in `staff_note`) and
audited as `privacy.export.started_by_staff` / `privacy.deletion.started_by_staff`.

{: .note }
An export a person asks for themselves is built by the queue worker. Locally, run
`node ace queue:work` beside the dev server or it stays _Queued_. Exports and deletions an admin
starts from the back office run on the click and do not need it.

### What is in the zip

```
data.json    one section per feature, as JSON
README.txt   what each section is, and what was left out and why
files/       the files the person uploaded
```

| Section             | What it holds                                                      |
| ------------------- | ------------------------------------------------------------------ |
| `account`           | Name, email, role, verification and last sign-in                   |
| `workspace`         | Their workspace, and its plan if they own it                       |
| `connectedAccounts` | Linked Google/GitHub accounts                                      |
| `files`             | Every upload not deleted, pointing at its copy in `files/`         |
| `invitationsSent`   | Role and dates — not the invited people's addresses                |
| `apiKeysCreated`    | Name, prefix, scopes, dates                                        |
| `supportTickets`    | Tickets they opened, with the whole conversation                   |
| `activity`          | Audit entries recorded under their account, with IP and browser    |
| `listsAndTodos`     | Lists they created; todos they created, were assigned or completed |
| `waitingList`       | Their waiting-list entry, if they joined before signing up         |
| `privacyRequests`   | Their own export and deletion requests                             |

**Never included:** other people's personal data, and anything that works as a credential —
passwords, two-factor secrets, recovery codes, API keys, OAuth tokens and sign-in tokens. A test
plants real values in every one of those places and searches the whole archive for them.

---

## Deleting your account

**Settings → Privacy → Delete my account.** The card says what will happen before it asks for
anything.

1. **Ask.** With a password, the person re-enters it and ticks _I understand_ — that confirms it.
   An account that signs in only with Google or GitHub has no password, so a single-use link
   (hashed, 24 hours) is emailed instead, and nothing happens until it is followed.
2. **Review.** It appears under **Admin → Privacy requests**, _Deletions_. The page works out
   _now_ what approving would do: whether the person is the last member of their workspace, and
   whether that workspace still has a subscription that charges. Only an **admin** can approve or
   reject (`StaffPolicy.eraseAccounts`); support can see it. A rejection needs a reason, which is
   emailed to the person.
3. **Delete.** Approval runs the deletion **there and then** — the account is gone when the
   admin's page comes back, with no worker needed. Everything happens in **one transaction** — the
   user row first, then each feature's share — so it either all happens or none of it does. Stored
   files are removed only after the commit. `process_privacy_deletion` is queued as well, as a
   safety net: if the immediate run fails it is retried by the worker, and otherwise it finds the
   request completed and does nothing. A failed run can be retried by an admin, and running it
   twice is harmless.
4. **Goodbye.** An email goes to the address they had, which was kept on the request only for
   this and cleared as it is sent.

A person can cancel until an admin approves. Staff impersonating the person cannot ask for them.

**An owner takes the workspace with them.** Deleting the owner of a workspace deletes every other
member's account the same way, and the workspace's lists, todos and files. The person is told this
before they ask (and that transferring ownership first avoids it), the admin is told how many
people it is before approving, and it is counted again when the deletion runs, in case someone
joined in between. The other members are emailed that their account was deleted and why; any
deletion request of their own is marked completed. The workspace row itself stays, for billing.

On **Admin → Privacy requests**, a deletion waiting for an admin has a **Delete account** item in
its row's actions menu that opens this review; the button there (**Delete account**, or **Delete account and
workspace** for an owner with members) is the approval.

### What happens to each kind of data

| Data                                                       | What happens                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The user row                                               | **Kept, never deleted, with its details overwritten by generic ones.** Email becomes `email<id>@deleteduser.com`, name becomes `Deleted User`; last sign-in, password, two-factor and the avatar key are cleared, and it is marked deleted, so nobody can sign in. Role and the created/verified dates stay. Every reference to it stays valid. |
| Connected Google/GitHub accounts, sign-in tokens           | Deleted                                                                                                                                                                                                                                                                                                                                         |
| Avatar                                                     | Deleted                                                                                                                                                                                                                                                                                                                                         |
| Other uploads                                              | Stay with the workspace — unless they were its **last member or its owner**, then every file in the workspace goes                                                                                                                                                                                                                              |
| Lists and todos                                            | Untouched while anybody else is in the workspace — not even an assignment. As the **last member or the owner**, every list and todo in it is deleted outright                                                                                                                                                                                   |
| Pending invitations they sent                              | Deleted (they hold somebody else's address)                                                                                                                                                                                                                                                                                                     |
| Support tickets, API keys they created                     | Stay with the workspace                                                                                                                                                                                                                                                                                                                         |
| Audit log                                                  | Stays — it is the security record — with IP addresses and browsers cleared                                                                                                                                                                                                                                                                      |
| Their waiting-list entry                                   | Deleted                                                                                                                                                                                                                                                                                                                                         |
| Subscriptions, payments, webhook events, the workspace row | **Never touched.** If the workspace still has a paying subscription, the admin is warned to cancel it by hand                                                                                                                                                                                                                                   |
| The privacy requests themselves                            | Kept, as the record that the request was honoured                                                                                                                                                                                                                                                                                               |

{: .warning }
`deleteduser.com` is not our domain. `MailerService` refuses to send anything to an address of the
`email<id>@deleteduser.com` form and logs that it did, so a notification queued for a deleted
account goes nowhere rather than to a stranger.

---

## How a feature reports its data

The export knows nothing about any table. It asks `#privacy/registry`, and every feature that
stores something about a person registers a **contributor** in `start/privacy.ts`:

```ts
export const projectsPrivacyContributor: PrivacyContributor = {
  key: 'projects',
  describes: 'Projects you created.',
  excludes: "Your colleagues' names — they are theirs.",
  covers: ['projects.created_by_user_id'],

  async export(user) {
    const projects = await Project.query().where('created_by_user_id', user.id)
    return projects.map((project) => ({ name: project.name, createdAt: project.createdAt.toISO() }))
  },
}
```

- **`export` lists its fields by hand.** Never `serialize()` a model: a column added next year
  would then be exported by default, secrets included.
- **`files`** (optional) returns stored files whose contents belong in the archive.
- **`covers`** names every column pointing at a user that the contributor accounts for.
  `tests/functional/privacy_coverage.spec.ts` reads the real schema and **fails when any column
  that references a user is claimed by nobody** — so a feature cannot add personal data and be
  left out of every export by accident. Columns that hold nothing personal go in its
  `NOT_PERSONAL` list, each with a reason.
- **`erase`** (optional) deletes or anonymises the contributor's rows. It runs inside the
  deletion's transaction and is handed `lastMember` (decided once, for everyone), the person's
  `originalEmail` (their row is already overwritten by then), and `afterCommit` for work like
  deleting stored objects. It must tolerate rows that are already gone. A module tests its own
  `erase` — see `app/modules/lists/tests/functional/privacy.spec.ts`.

---

## Where it lives

```
app/privacy/                    core: the registry and core's own contributors
app/modules/privacy/
  models/privacy_request.ts
  services/privacy_service.ts   request, build, download, purge
  services/export_builder.ts    the zip — data.json, README.txt, files/
  jobs/                         generate_privacy_export, purge_privacy_exports (hourly)
  controllers/, routes.ts, throttles.ts, mails/, settings.ts, audit_actions.ts
  privacy.ts                    its own contributor: the person's requests
  tests/functional/
```

Plus `resources/views/pages/privacy/`, `resources/views/emails/privacy_export_ready*.edge` and the
migration `1788600000028_create_privacy_requests_table.ts`. It adds `yazl` as a dependency.

The registry, `start/privacy.ts`, core's contributors and the mailer's refusal to email a deleted
address are core, and stay if the module is removed.

---

## Removing it

Checked by doing it: with the module removed as below, the suite passes and `npm run typecheck` is
clean.

**1. Delete the module and its views.**

```bash
rm -rf app/modules/privacy resources/views/pages/privacy
rm resources/views/emails/privacy_*.edge docs/privacy.md
```

**2. Unregister it** — each is a block plus its import:

| File                      | What to remove                                                       |
| ------------------------- | -------------------------------------------------------------------- |
| `start/routes/web.ts`     | `registerPrivacyWebRoutes()`                                         |
| `start/routes/admin.ts`   | `registerPrivacyAdminRoutes()`                                       |
| `start/routes/auth.ts`    | `registerPrivacyTokenRoutes()`                                       |
| `start/jobs.ts`           | the Privacy block and its three job imports                          |
| `start/settings.ts`       | `registerPrivacySettings()`                                          |
| `start/privacy.ts`        | `privacy.register(privacyRequestsContributor)`                       |
| `config/database.ts`      | `#modules/privacy/schema_rules` in `rulesPaths`, on both connections |
| `app/models/public_id.ts` | `privacyRequest: 'prq'`                                              |

**3. Drop the table — required, not optional.** Unlike the other modules' tables,
`privacy_requests` holds a `user_id`, so leaving it would fail
`tests/functional/privacy_coverage.spec.ts` (a column pointing at a user that nothing accounts
for) and keep personal data nobody can reach:

```ts
// database/migrations/<timestamp>_drop_privacy_requests_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.dropTableIfExists('privacy_requests')
  }
}
```

The module's own migrations roll back cleanly past it. Do not delete them.

**4. Drop the dependency**, if nothing else uses it: `npm uninstall yazl @types/yazl`, then
`npm run format`.

**Check:** `npm run typecheck`, `npm run lint`, `node ace test`.
