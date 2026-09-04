import { DateTime } from 'luxon'

import type User from '#models/user'
import type Organization from '#models/organization'
import registration from '#auth/registration_service'
import twoFactor from '#auth/two_factor_service'

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
