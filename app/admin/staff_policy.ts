import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type StaffUser from '#models/staff_user'

/**
 * What support may do, and what only an admin may (plan §6).
 *
 * The split is not seniority — it is blast radius. Support can see
 * everything and fix the things a customer is blocked on; admin is required
 * for anything that moves money, removes access, or changes what somebody is
 * entitled to.
 *
 * Every method takes the actor explicitly, like every other policy here, so
 * an impersonating request goes through the same checks.
 */
export default class StaffPolicy extends BasePolicy {
  /**
   * Reading. Support exists to answer questions, so it can see organisations,
   * users, subscriptions, the webhook ledger, the job queue and the audit
   * log.
   */
  view(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled
  }

  /**
   * Unblocking a customer: resend a verification email, confirm an address,
   * reset a lost second factor. Reversible, scoped to one person, and the
   * reason somebody opened a ticket.
   */
  assistUser(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled
  }

  /**
   * Retrying a job or replaying a stored webhook.
   *
   * Support-level because both are **idempotent by construction** — the
   * queue is at-least-once and the webhook handler upserts on provider ids,
   * so the worst case of replaying one is that nothing changes.
   */
  replay(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled
  }

  /**
   * Impersonation is support-level, but read-only for support and writable
   * for admin — enforced per request in `ImpersonationMiddleware`, because
   * it is a property of every request in the session rather than of starting
   * one.
   */
  impersonate(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled
  }

  /**
   * Changing what a customer is entitled to without a payment behind it.
   * Admin only: it is a discount nobody invoiced.
   */
  overridePlan(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled && staff.isAdmin
  }

  /**
   * Cancelling a subscription from our side, and suspending a workspace.
   * Admin only: both take a paying customer's access away.
   */
  manageSubscription(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled && staff.isAdmin
  }

  suspendOrganization(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled && staff.isAdmin
  }

  /**
   * Writing an announcement that reaches customers (plan §20.6).
   *
   * Admin only, for the same reason a plan override is: it changes what a
   * customer experiences, and it cannot be taken back once read. Support can
   * *see* the list — it needs to answer "did they get told?" — through
   * `view` above.
   */
  /**
   * Answering support tickets (plan §21.6).
   *
   * Support **and** admin, unlike the other write actions here. Answering
   * customers is the support role's entire reason to exist; this is the one
   * back-office surface where the §6 split does not narrow to admin.
   */
  answerSupport(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled
  }

  manageNotifications(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled && staff.isAdmin
  }

  /**
   * Admin only, and the reason: anyone who can create a staff account can
   * grant themselves everything above.
   */
  manageStaff(staff: StaffUser): AuthorizerResponse {
    return !staff.isDisabled && staff.isAdmin
  }
}
