import { createHmac } from 'node:crypto'
import { DateTime } from 'luxon'

import type User from '#models/user'
import type ApiKey from '#models/api_key'
import type StaffUser from '#models/staff_user'
import type Organization from '#models/organization'
import type { ApiScope } from '#api/scopes'
import registration from '#auth/registration_service'
import twoFactor from '#auth/two_factor_service'
import { CreemProvider } from '#billing/providers/creem'
import { fakePaymentProvider, restorePaymentProvider } from '#billing/provider'
import type { CheckoutInput, PaymentProvider, ProviderSubscription } from '#billing/contracts'

export const TEST_PASSWORD = 'secret-password-12'

/**
 * A rendered email waiting on the queue.
 *
 * Since M3 nothing is sent inline — `MailerService` renders the message and
 * dispatches a `send_mail` job — so "did we email them?" is answered by
 * looking at the queue. That is a stronger assertion than the old fake-mailer
 * one: the message here has already been through its Edge templates, so a
 * broken template fails the test rather than passing it.
 */
export interface QueuedMail {
  jobId: number
  to: string[]
  subject: string
  html: string
  text: string
}

export async function queuedMails(): Promise<QueuedMail[]> {
  const { default: Job } = await import('#models/job')

  const jobs = await Job.query().where('name', 'send_mail').orderBy('id', 'asc')

  return jobs.map((job) => {
    const message = (job.payload as any)?.compiled?.message ?? {}

    return {
      jobId: job.id,
      to: (message.to ?? []).map((recipient: any) =>
        typeof recipient === 'string' ? recipient : recipient.address
      ),
      subject: message.subject ?? '',
      html: message.html ?? '',
      text: message.text ?? '',
    }
  })
}

/**
 * Emails queued for one address.
 */
export async function queuedMailsTo(email: string): Promise<QueuedMail[]> {
  const mails = await queuedMails()
  return mails.filter((mail) => mail.to.includes(email.toLowerCase()))
}

/**
 * A list with some todos, through the real services so the counter and the
 * positions are built the way the application builds them.
 */
export async function createList(
  organization: Organization,
  owner: User,
  name = 'Launch checklist',
  titles: string[] = []
) {
  const { default: lists } = await import('#todos/list_service')
  const { default: todos } = await import('#todos/todo_service')

  const list = await lists.create(organization, owner, { name })

  for (const title of titles) {
    await todos.create(organization, list, owner, { title })
  }

  await list.refresh()

  return list
}

/**
 * Drain the queue the way `queue:work` does — same reservation, same
 * registry, same failure handling — so a test can assert on what a handler
 * actually did rather than on the row that asked for it.
 */
export async function runQueue(queueName = 'default', passes = 5): Promise<number> {
  const { default: queue } = await import('#queue/queue_service')
  const { handlerFor } = await import('#queue/registry')
  const { UnrecoverableJobError } = await import('#queue/contracts')

  let processed = 0

  for (let pass = 0; pass < passes; pass++) {
    const jobs = await queue.reserve(queueName, 25)

    if (jobs.length === 0) {
      break
    }

    for (const job of jobs) {
      const handler = handlerFor(job.name)

      if (!handler) {
        await queue.fail(job, new UnrecoverableJobError(`No handler for job "${job.name}"`))
        continue
      }

      try {
        await handler.handle(job.payload ?? {}, { job, isFinalAttempt: job.isFinalAttempt })
        await queue.complete(job)
        processed++
      } catch (error) {
        await queue.fail(job, error)
      }
    }
  }

  return processed
}

/**
 * Create an organisation and its owner through the real registration path, so
 * tests exercise the same code a signup does rather than a parallel fixture
 * that can drift from it.
 */
export async function createWorkspace(
  overrides: { email?: string; fullName?: string; verified?: boolean } = {}
): Promise<{ user: User; organization: Organization }> {
  const result = await registration.register({
    email: overrides.email ?? `owner-${Math.random().toString(36).slice(2, 10)}@example.com`,
    fullName: overrides.fullName ?? 'Jane Cooper',
    password: TEST_PASSWORD,
  })

  if (overrides.verified !== false) {
    result.user.emailVerifiedAt = DateTime.utc()
    await result.user.save()
  }

  return result
}

/**
 * Add a member to an existing organisation, through the invitation flow so
 * tests exercise the real path rather than inserting a row directly.
 */
export async function addMember(
  organization: Organization,
  owner: User,
  email: string,
  fullName = 'Sam Member'
): Promise<User> {
  const { default: invitations } = await import('#organizations/invitation_service')
  const { token } = await invitations.invite({ organization, invitedBy: owner, email })

  return invitations.accept({ token, fullName, password: TEST_PASSWORD })
}

/**
 * Enrol and confirm two-factor for a subject, returning its secret and
 * recovery codes so a test can produce valid codes.
 */
export async function enableTwoFactor(subject: Parameters<typeof twoFactor.beginEnrolment>[0]) {
  const { secret } = await twoFactor.beginEnrolment(subject)
  const { generate } = await import('otplib')
  const token = await generate({ secret })
  const recoveryCodes = await twoFactor.confirmEnrolment(subject, token)

  return { secret, recoveryCodes: recoveryCodes ?? [] }
}

/**
 * A currently-valid TOTP code for a secret.
 */
export async function totpFor(secret: string): Promise<string> {
  const { generate } = await import('otplib')
  return generate({ secret })
}

/**
 * A payment provider that answers from memory (plan §15).
 *
 * Billing is the one area where a test that reaches the network is worse than
 * no test: it needs an account, it is slow, and it charges things. This
 * records what was asked of it and answers with whatever the test set up, so
 * the checkout and portal flows are exercised end to end through the real
 * controllers.
 *
 * Webhook parsing and signature verification are deliberately **not** faked —
 * they delegate to the real `CreemProvider`, because those two are exactly
 * what a billing test is for.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'creem'

  checkouts: CheckoutInput[] = []
  portals: { customerId: string; returnUrl: string }[] = []
  subscriptions = new Map<string, ProviderSubscription>()

  /**
   * What was asked of the provider, so a test can assert that a refused
   * action never reached it — "nothing changed locally" is not the same as
   * "we did not tell them to cancel".
   */
  cancellations: { subscriptionId: string; atPeriodEnd: boolean }[] = []

  /**
   * Set to make the next provider call fail, the way an outage does.
   */
  failWith: Error | null = null

  private real = new CreemProvider({
    apiKey: 'test-api-key',
    apiUrl: 'https://test-api.creem.io',
    webhookSecret: CREEM_TEST_SECRET,
  })

  async createCheckoutSession(input: CheckoutInput) {
    this.throwIfFailing()
    this.checkouts.push(input)

    return { url: `https://checkout.test/${input.productId}`, sessionId: 'ch_test_1' }
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }) {
    this.throwIfFailing()
    this.portals.push(input)

    return { url: `https://portal.test/${input.customerId}` }
  }

  async getSubscription(id: string) {
    this.throwIfFailing()
    return this.subscriptions.get(id) ?? null
  }

  async changePlan(input: { subscriptionId: string; productId: string }) {
    this.throwIfFailing()
    return this.subscriptions.get(input.subscriptionId)!
  }

  async cancelSubscription(input: { subscriptionId: string; atPeriodEnd: boolean }) {
    this.throwIfFailing()
    this.cancellations.push(input)

    return this.subscriptions.get(input.subscriptionId)!
  }

  async resumeSubscription(id: string) {
    this.throwIfFailing()
    return this.subscriptions.get(id)!
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    return this.real.verifyWebhook(rawBody, headers)
  }

  parseWebhook(rawBody: Buffer) {
    return this.real.parseWebhook(rawBody)
  }

  private throwIfFailing() {
    if (this.failWith) {
      const error = this.failWith
      this.failWith = null
      throw error
    }
  }
}

/**
 * Must match `CREEM_WEBHOOK_SECRET` in `.env.test`, because the signature
 * check under test is the real one.
 */
export const CREEM_TEST_SECRET = 'test-webhook-secret'

/**
 * Install the fake for one test and take it away afterwards, so a leaked
 * provider cannot make the next test pass for the wrong reason.
 */
export function useFakePaymentProvider(): FakePaymentProvider {
  const fake = new FakePaymentProvider()
  fakePaymentProvider(fake)
  return fake
}

export { restorePaymentProvider }

/**
 * A Creem webhook body and its signature.
 *
 * The signature is HMAC-SHA256 over `JSON.stringify(body)`, which is exactly
 * the bytes the test client will put on the wire when the same object is
 * passed to `.json()` — so the real signature check runs against a real
 * match, and tampering with the body in a test genuinely breaks it.
 */
export function signedWebhook(body: Record<string, any>): {
  body: Record<string, any>
  raw: string
  headers: Record<string, string>
} {
  const raw = JSON.stringify(body)
  const signature = createHmac('sha256', CREEM_TEST_SECRET).update(raw).digest('hex')

  return { body, raw, headers: { 'creem-signature': signature } }
}

/**
 * A `subscription.active` payload for an organisation, with the fields the
 * handler actually reads.
 */
export function subscriptionWebhook(options: {
  eventId?: string
  eventType?: string
  subscriptionId?: string
  organizationPublicId?: string
  productId?: string
  status?: string
  createdAt?: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd?: boolean
}): Record<string, any> {
  return {
    id: options.eventId ?? `evt_${Math.random().toString(36).slice(2, 10)}`,
    eventType: options.eventType ?? 'subscription.active',
    created_at: options.createdAt ?? new Date().toISOString(),
    object: {
      id: options.subscriptionId ?? 'sub_test_1',
      status: options.status ?? 'active',
      customer: { id: 'cus_test_1' },
      product: { id: options.productId ?? 'prod_test_pro' },
      current_period_start_date: new Date().toISOString(),
      current_period_end_date:
        options.currentPeriodEnd ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
      cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
      metadata: options.organizationPublicId
        ? { organization_public_id: options.organizationPublicId }
        : {},
    },
  }
}

/**
 * Bytes that look like each of the formats the allowlist accepts.
 *
 * Real magic numbers, because the sniffer under test reads them (plan §10) —
 * a fixture that only satisfies a fake would prove nothing about a real
 * upload.
 */
export const FILE_FIXTURES = {
  png: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 0x01),
  ]),
  jpg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x02)]),
  gif: Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(64, 0x03)]),
  webp: Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(64, 0x04),
  ]),
  pdf: Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), Buffer.alloc(64, 0x05)]),
  txt: Buffer.from('a plain note, nothing more\n', 'utf8'),
  csv: Buffer.from('name,quantity\nwidget,3\n', 'utf8'),

  /**
   * The upload this whole layer exists to refuse: a document that a sniffing
   * browser would render as HTML, wearing an image extension.
   */
  html: Buffer.from('<html><script>alert(1)</script></html>', 'utf8'),
} as const

/**
 * Write a fixture to a temporary path and hand back what an upload looks
 * like to `FileService`.
 */
export async function fixtureUpload(
  kind: keyof typeof FILE_FIXTURES,
  options: { clientName?: string; bytes?: Buffer } = {}
): Promise<{ tmpPath: string; clientName: string; sizeBytes: number }> {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const bytes = options.bytes ?? Buffer.from(FILE_FIXTURES[kind])
  const directory = await mkdtemp(join(tmpdir(), 'upload-'))
  const clientName = options.clientName ?? `fixture.${kind}`
  const tmpPath = join(directory, 'upload.bin')

  await writeFile(tmpPath, bytes)

  return { tmpPath, clientName, sizeBytes: bytes.length }
}

/**
 * Empty the local disks between tests, so one test's uploads cannot make the
 * next one's orphan-detection lie.
 */
export async function clearStorage(): Promise<void> {
  const { rm } = await import('node:fs/promises')
  const { default: app } = await import('@adonisjs/core/services/app')
  const { default: env } = await import('#start/env')

  await rm(app.makePath(env.get('DRIVE_FS_ROOT', 'storage')), { recursive: true, force: true })
}

/**
 * A workspace on a plan that includes the API, with a key.
 *
 * Every API test needs all three, and building them by hand invites one test
 * quietly granting itself a scope another does not have.
 */
export async function createApiWorkspace(
  options: { planKey?: 'pro' | 'business'; scopes?: ApiScope[]; name?: string } = {}
): Promise<{
  user: User
  organization: Organization
  apiKey: ApiKey
  secret: string
  headers: Record<string, string>
}> {
  const { default: apiKeys } = await import('#api/api_key_service')

  const { user, organization } = await createWorkspace()

  organization.planKey = options.planKey ?? 'pro'
  await organization.save()

  const { apiKey, secret } = await apiKeys.create(organization, user, {
    name: options.name ?? 'test key',
    scopes: options.scopes ?? [
      'lists:read',
      'lists:write',
      'todos:read',
      'todos:write',
      'members:read',
    ],
  })

  return {
    user,
    organization,
    apiKey,
    secret,
    headers: { authorization: `Bearer ${secret}` },
  }
}

/**
 * Reset the rate limiter between tests.
 *
 * The store is process-global while the database is truncated per test, so
 * ids repeat and one test's traffic would otherwise land in the next one's
 * bucket — and a rate-limit test that fails because of the test before it is
 * worse than none.
 */
export async function clearRateLimits(): Promise<void> {
  const { default: limiter } = await import('@adonisjs/limiter/services/main')

  await limiter.clear()
}

/**
 * A staff account with two-factor already enrolled, ready to sign in.
 *
 * Two-factor is mandatory for staff, so a fixture without it lands on the
 * enrolment screen instead of the back-office — which makes every admin test
 * look like an authorisation failure.
 */
export async function createStaff(
  overrides: { email?: string; role?: 'admin' | 'support'; disabled?: boolean } = {}
): Promise<StaffUser> {
  const { default: StaffUser } = await import('#models/staff_user')

  const staff = await StaffUser.create({
    email: overrides.email ?? `staff-${Math.random().toString(36).slice(2, 10)}@example.com`,
    fullName: 'Sam Staff',
    password: TEST_PASSWORD,
    role: overrides.role ?? 'admin',
  })

  await enableTwoFactor(staff)

  if (overrides.disabled) {
    staff.disabledAt = DateTime.utc()
    await staff.save()
  }

  return staff
}

/**
 * A published announcement, through the real service so the audience payload
 * is normalised the way authoring normalises it.
 */
export async function createNotification(
  overrides: {
    title?: string
    body?: string
    audienceType?: 'all' | 'plan' | 'owners' | 'users'
    planKeys?: string[]
    userIds?: number[]
    publishNow?: boolean
    publishedAt?: DateTime | null
    expiresAt?: DateTime | null
  } = {}
) {
  const { default: notifications } = await import('#notifications/notification_service')
  const staff = await createStaff()

  const notification = await notifications.create(staff, {
    title: overrides.title ?? 'Something changed',
    body: overrides.body ?? 'The body of the announcement.',
    audienceType: overrides.audienceType ?? 'all',
    audience: { planKeys: overrides.planKeys, userIds: overrides.userIds },
    publishNow: overrides.publishNow,
    expiresAt: overrides.expiresAt ?? null,
  })

  /**
   * Backdating is how a test says "this was published before you last
   * looked", which is the whole of the unread rule.
   */
  if (overrides.publishedAt !== undefined) {
    notification.publishedAt = overrides.publishedAt
    await notification.save()
  }

  return notification
}
