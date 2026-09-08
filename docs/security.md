# Security

What this application does about the usual attacks, what it deliberately does not, and what is
left for whoever deploys it. Written against the OWASP Top 10 (2021) because that is the list
people ask about, and reviewed in full at M8.

If you find something wrong here, the fix belongs in code and in this file — an inaccurate security
document is worse than none, because it is read instead of the code.

---

## A01 · Broken access control

Every tenant screen is behind the same middleware stack — `auth → verifiedEmail → organization` —
so a route cannot be added that forgets to scope itself. Queries scope through the organisation on
the context, never an id from the request: no endpoint in the application accepts an organisation
identifier, which is the property that makes cross-tenant access a code change rather than a
crafted request.

Above that, [Bouncer](https://docs.adonisjs.com/guides/security/authorization) policies decide who
may do what, and the back-office has a **second, separate** Bouncer over its own `staff_users`
table and its own guard — there is no path by which a staff session is mistaken for a tenant
session, or the reverse.

`tests/functional/tenant_isolation.spec.ts` seeds two organisations and asserts, endpoint by
endpoint, that one can never read or mutate the other, including the awkward injections: assigning
a todo to the other workspace's user, moving a todo into its list, fetching a row by its public id.

**Impersonation** (§12) is admin-or-support, time-limited, announced by a banner the customer's
own screens carry, and audited at both ends. Support impersonation is read-only, enforced by HTTP
method rather than by a list of routes — every mutation in this application is a `POST`, and a rule
written as a list is a rule somebody forgets to extend.

## A02 · Cryptographic failures

Passwords are hashed with scrypt (`config/hash.ts`). Tokens — password reset, email verification,
invitations, API keys — are random bytes, stored only as a SHA-256 hash, and compared with
`timingSafeEqual`. A token is shown to a human exactly once, at the moment it is created.

API keys are hashed rather than encrypted, deliberately: nothing needs to read one back, and a
key that cannot be recovered cannot be leaked by a database dump.

Cookies are `httpOnly`, `sameSite=lax`, and `secure` in production. HSTS is sent for 180 days.
Every third-party credential is declared with `Env.schema.secret()`, which makes it a `Secret`
wrapper that cannot be logged or serialised by accident.

**Your part**: TLS everywhere, `DB_SSL=true` on a managed database, and `APP_KEY` kept secret —
every session cookie and every signed URL is derived from it.

## A03 · Injection

All database access goes through Lucid's query builder; there is no raw SQL in the application, and
the one raw request read (`request.raw()`) exists because a webhook signature must be verified over
exactly the bytes that were sent.

Output is escaped by Edge. The rule inside a component is that slot output is already-rendered
markup and is printed raw, while a `text` **prop** is a value and is escaped — several flash
messages are built from a file name or a list name somebody typed, so this is not theoretical.
`tests/functional/hardening/output_escaping.spec.ts` pins both that and the textarea case, where
`</textarea>` in old input closes the element early.

Uploads are validated by extension *and* by sniffing the bytes, and are refused when the two
disagree rather than being corrected. Stored objects are named with a UUID, never with the client's
filename: a filename from a request can carry path traversal, a second extension, or somebody
else's key.

## A04 · Insecure design

The decisions and their trade-offs are in [`plan.md`](../plan.md), which is the point of that
document. The ones that are security decisions:

- Webhooks are the only source of truth for entitlements; the return from checkout grants nothing.
- Quotas are enforced inside the same transaction as the insert, with a row lock, so two parallel
  requests at cap-1 cannot both succeed. There is a test that runs exactly that race.
- A downgrade never deletes anything — it soft-locks (§7.4). Data loss as a billing side effect is
  a security incident with a business name.
- One organisation per user (D1), which removes a whole class of "which tenant am I acting as"
  confusion.

## A05 · Security misconfiguration

A Content-Security-Policy is enforced (`config/shield.ts`). The load-bearing part is
`script-src 'self' '@nonce'`: an injected `<script>` carries no nonce, so it does not run. Three
compromises are documented at the directive that makes them — `'unsafe-eval'` for Alpine's
expression compiler, `'unsafe-inline'` for styles, and `form-action` allowing HTTPS targets because
checkout is a form POST that redirects to the payment provider.

Alongside it: `X-Frame-Options: DENY` and `frame-ancestors 'none'`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and
`X-Permitted-Cross-Domain-Policies` — the last four from
`app/middleware/security_headers.ts`, on the server stack so a 404 gets them too.

Error output differs by environment: stack traces in development, status pages in production, and
the API answers a `500` with a request id and nothing else. `/styleguide` exists only in
development. `dev:seed` and `DEV_TWO_FACTOR_CODE` refuse to work outside it.

**Your part**: `TRUST_PROXY` matching reality (see [deployment](./deployment.md)), an object store
that is private by default, and `ADMIN_IP_ALLOWLIST` set.

## A06 · Vulnerable and outdated components

Dependencies are pinned by `package-lock.json` and CI runs `npm ci`. There is no automated
dependency-update job configured — enabling Dependabot or Renovate is a two-line file and is
recommended before this runs anywhere real.

## A07 · Identification and authentication failures

Passwords are at least 12 characters, with no composition rules and no forced rotation, which is
what NIST has recommended since 2017. TOTP two-factor with single-use recovery codes is available
to every user and **mandatory** for staff. The session id is regenerated on login. Password reset
and email verification tokens are single-use and expire.

Neither the login form nor the reset form says whether an address has an account.

Rate limits cover the whole signed-out surface (`start/limiter.ts`, M8), keyed for what each is
protecting: address for the broad cover, address-and-account for sign-in so nobody can lock a
stranger out of their own login, account for the flows whose cost is an email, and the pending
challenge for second-factor attempts — six digits is only safe while guesses are slow.

## A08 · Software and data integrity failures

Payment webhooks are verified as an HMAC over the raw body, compared in constant time, recorded in
an idempotency ledger, and processed by a queued job with a watermark so an out-of-order delivery
cannot move a subscription backwards. An event type we do not recognise throws rather than being
dropped: a silently ignored billing event is indistinguishable from one that never arrived.

The front-end bundle is built from source in this repository. The one third-party script is the
API-reference viewer on `/docs`, loaded from a CDN and named explicitly in the policy; it is a page
you can delete.

## A09 · Security logging and monitoring failures

Every consequential back-office action is written to `audit_logs` with the actor, the target, and
the address it came from — including the start and end of every impersonation. Logs are structured
JSON with a request id that the API also hands to the client, so a customer's error report maps to
a specific request.

**Your part**: ship the logs somewhere searchable and alert on the signals listed in the
[deployment guide](./deployment.md#watching-it). Nothing in here pages anybody by itself.

## A10 · Server-side request forgery

The application makes outbound requests to exactly three places, all of them configured rather than
supplied: the payment provider, the mail provider, and object storage. No endpoint fetches a URL on
a user's behalf. If you add one — an avatar-by-URL import, a webhook *out* — that is the feature
that needs an allowlist and a resolver that refuses private address ranges.

---

## Deliberately not here

Named so that their absence is a decision rather than an oversight:

- **Automated dependency scanning.** See A06.
- **Server-side session revocation.** Sessions are cookie-based by default, so "sign out everywhere"
  is not instantaneous. `SESSION_DRIVER=database` buys it, at the cost of a read per request.
- **A WAF, bot detection, or CAPTCHA.** The rate limits are the whole of the abuse defence. A
  signup form on the open internet will eventually want more.
- **Field-level encryption.** Nothing in the schema is encrypted at rest beyond what the database
  does for you.
- **Password breach checks** (Have I Been Pwned's k-anonymity API), which would be a good addition
  and is one service call at signup and password change.
- **Anomaly alerting** — repeated 403s, a burst of failed logins for one account, an impersonation
  outside working hours. The audit log has the data; nothing reads it.

## Reporting something

If you are using this as the basis for your own product, put a real address here and mean it. An
unreachable security contact is how a finding becomes a disclosure.
