import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'

import AuditLog from '#models/audit_log'
import type Organization from '#models/organization'

/**
 * Everything worth being able to answer "who did this?" about (plan §12).
 *
 * The action strings are a closed set for the same reason API error codes
 * are: screens filter on them and support reads them months later, so
 * renaming one orphans the history it describes.
 */
export const AUDIT_ACTIONS = {
  staffSignedIn: 'staff.signed_in',
  staffCreated: 'staff.created',
  staffDisabled: 'staff.disabled',
  staffEnabled: 'staff.enabled',

  impersonationStarted: 'impersonation.started',
  impersonationEnded: 'impersonation.ended',

  organizationSuspended: 'organization.suspended',
  organizationRestored: 'organization.restored',
  planOverridden: 'organization.plan_overridden',
  limitsOverridden: 'organization.limits_overridden',

  subscriptionSynced: 'subscription.synced',
  subscriptionCanceled: 'subscription.canceled_by_staff',

  webhookReplayed: 'webhook.replayed',

  notificationCreated: 'notification.created',
  notificationPublished: 'notification.published',
  notificationDeleted: 'notification.deleted',

  supportTicketOpened: 'support.ticket.opened',
  supportReplied: 'support.replied',
  supportResolved: 'support.resolved',
  supportAssigned: 'support.assigned',

  userVerificationResent: 'user.verification_resent',
  userVerified: 'user.verified_by_staff',
  userTwoFactorReset: 'user.two_factor_reset',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

export interface AuditEntry {
  action: AuditAction
  organization?: Organization | { id: number } | null
  subjectType?: string | null
  subjectId?: string | number | null
  metadata?: Record<string, any> | null

  /**
   * Overrides the actor taken from the guard.
   *
   * Needed for exactly one case: ending an impersonation happens on a tenant
   * route, which has no staff middleware, so the guard has no staff user to
   * offer. Taking the id from the session instead is the difference between
   * a record and an "ended by nobody" entry that only looks like one.
   */
  actorId?: number | null
}

/**
 * Writes and reads the audit trail.
 *
 * Deliberately not a queue job: an audit entry that is dispatched can be
 * lost, and "we cannot tell you who cancelled that subscription because the
 * worker was down" is not an acceptable answer. It is one insert.
 */
export class AuditService {
  /**
   * Record something a staff member did.
   *
   * Takes the HTTP context so the actor, the IP and the user agent come from
   * one place — an audit call that has to be told who the actor is will
   * eventually be told the wrong one.
   */
  async recordStaffAction(ctx: HttpContext, entry: AuditEntry): Promise<void> {
    const staff = ctx.auth.use('staff').user

    return this.write(ctx, {
      ...entry,
      actorType: 'staff',
      actorId: entry.actorId ?? staff?.id ?? null,
      metadata: {
        ...(entry.metadata ?? {}),
        staffEmail: entry.metadata?.staffEmail ?? staff?.email,
      },
    })
  }

  /**
   * Record something a tenant user did.
   *
   * When the request is being made by a staff member impersonating them, the
   * entry is still attributed to the **user** — that is who the action was
   * taken as — with the staff id alongside it. Losing either half makes the
   * trail a lie in one direction or the other (plan §6).
   */
  async recordUserAction(ctx: HttpContext, entry: AuditEntry): Promise<void> {
    const user = ctx.auth.use('web').user

    return this.write(ctx, {
      ...entry,
      actorType: 'user',
      actorId: user?.id ?? null,
      organization: entry.organization ?? (user ? { id: user.organizationId } : null),
      metadata: {
        ...(entry.metadata ?? {}),
        ...(ctx.impersonation ? { impersonatorStaffId: ctx.impersonation.staffId } : {}),
      },
    })
  }

  /**
   * Record something nobody did — a job, a webhook, a scheduled sweep.
   */
  async recordSystemAction(entry: AuditEntry): Promise<void> {
    return this.write(null, { ...entry, actorType: 'system', actorId: null })
  }

  private async write(
    ctx: HttpContext | null,
    entry: AuditEntry & { actorType: AuditLog['actorType']; actorId: number | null }
  ): Promise<void> {
    try {
      await AuditLog.create({
        organizationId: entry.organization?.id ?? null,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        subjectType: entry.subjectType ?? null,
        subjectId:
          entry.subjectId === null || entry.subjectId === undefined
            ? null
            : String(entry.subjectId),
        metadata: entry.metadata ?? null,
        ip: ctx?.request.ip() ?? null,
        userAgent: ctx?.request.header('user-agent')?.slice(0, 512) ?? null,
        createdAt: DateTime.utc(),
      })
    } catch (error) {
      /**
       * Never allowed to fail the action it is describing. A support agent
       * whose "suspend this workspace" 500s because the audit insert broke
       * will simply do it again, and now there are two attempts and still no
       * record — so this is logged loudly and swallowed.
       */
      logger.error({ err: error, action: entry.action }, 'could not write an audit entry')
    }
  }

  /**
   * The audit log screen (plan §12), filtered.
   *
   * Everything is optional and combines, because the questions support
   * actually asks are compound: "what did this staff member do to this
   * customer last week".
   */
  async search(filters: {
    organizationId?: number | null
    actorType?: AuditLog['actorType'] | null
    action?: string | null
    limit?: number
  }): Promise<AuditLog[]> {
    const query = AuditLog.query()
      .orderBy('id', 'desc')
      .limit(filters.limit ?? 100)

    if (filters.organizationId) {
      query.where('organization_id', filters.organizationId)
    }

    if (filters.actorType) {
      query.where('actor_type', filters.actorType)
    }

    if (filters.action) {
      query.where('action', filters.action)
    }

    return query
  }

  /**
   * Everything that happened to one organisation — the tab support opens
   * first when a customer says "something changed and we did not do it".
   */
  async forOrganization(organization: Organization, limit = 50): Promise<AuditLog[]> {
    return AuditLog.query()
      .where('organization_id', organization.id)
      .orderBy('id', 'desc')
      .limit(limit)
  }

  /**
   * The distinct actions present, for the filter dropdown. Read from the data
   * rather than from `AUDIT_ACTIONS` so the list only ever offers filters
   * that would return something.
   */
  async recordedActions(): Promise<string[]> {
    const rows = await AuditLog.query().distinct('action').orderBy('action', 'asc')

    return rows.map((row) => row.action)
  }
}

export default new AuditService()
