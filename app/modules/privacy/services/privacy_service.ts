import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

import env from '#start/env'
import User from '#models/user'
import type StaffUser from '#models/staff_user'
import AuditLog from '#models/audit_log'
import mailer from '#mail/mailer_service'
import queue from '#queue/queue_service'
import audit from '#audit/audit_service'
import storage from '#storage/disk_storage'
import registry from '#privacy/registry'
import settings from '#settings/settings_service'
import PrivacyRequest from '#modules/privacy/models/privacy_request'
import { buildExport } from '#modules/privacy/services/export_builder'
import PrivacyExportReadyNotification from '#modules/privacy/mails/privacy_export_ready_notification'
import '#modules/privacy/audit_actions'

/**
 * How long a download link lasts once somebody clicks *Download*. Short,
 * because the link itself is the credential while it lives.
 */
const DOWNLOAD_LINK_TTL = '5m'

/**
 * The most of a `data.json` the back office will render. Past this the admin
 * downloads the archive instead — a page is not the place for megabytes.
 */
const REPORT_VIEW_LIMIT_BYTES = 1024 * 1024

/**
 * What an operator sees when an export could not be built. Deliberately
 * generic: the real error is in the log, and nothing from the person's data
 * belongs in a column staff can read.
 */
const FAILURE_REASON = 'The archive could not be built. The error is in the worker log.'

/**
 * The back-office filters (plan §22.8.3), each a narrowing of the list.
 */
export const ADMIN_FILTERS = {
  all: {},
  export: { type: 'export' },
  deletion: { type: 'deletion' },
  pending: { statuses: ['requested', 'confirmed', 'approved'] },
  processing: { statuses: ['processing'] },
  completed: { statuses: ['completed'] },
  failed: { statuses: ['failed'] },
} as const satisfies Record<
  string,
  { type?: PrivacyRequest['type']; statuses?: readonly PrivacyRequest['status'][] }
>

export type AdminFilter = keyof typeof ADMIN_FILTERS

/**
 * A staff-started export's `data.json`, ready to show: one entry per section.
 */
export type ReportView =
  | { tooLarge: true }
  | {
      tooLarge: false
      exportedAt: string | null
      sections: { key: string; describes: string | null; json: string }[]
    }

/**
 * Where a staff-started export's `data.json` sits beside its archive.
 */
function dataKeyFor(request: PrivacyRequest) {
  return `privacy/${request.publicId}.json`
}

/**
 * A refused staff action — shown to the staff member as-is.
 */
export class PrivacyError extends Error {}

/**
 * Data exports (plan §22.8.1). Deletion arrives in the next slice.
 */
export class PrivacyService {
  /**
   * The person's own requests. Ones staff started on their behalf are not
   * listed: a staff-started export is for staff to download, never handed to
   * whoever is signed in to the account.
   */
  async requestsFor(user: User): Promise<PrivacyRequest[]> {
    return PrivacyRequest.query()
      .where('user_id', user.id)
      .whereNull('requested_by_staff_id')
      .orderBy('id', 'desc')
      .limit(20)
  }

  async findOwned(user: User, publicId: string): Promise<PrivacyRequest | null> {
    return PrivacyRequest.query()
      .where('public_id', publicId)
      .where('user_id', user.id)
      .whereNull('requested_by_staff_id')
      .first()
  }

  /**
   * Ask for an export. At most one is in progress per person: asking again
   * while one is being built returns that one rather than queueing a second
   * archive of the same data.
   *
   * The user row is locked for the check, so two clicks at once cannot both
   * see "nothing in progress" — the partial unique index that would do this
   * in SQL is a Postgres-only feature (plan §5.1, rule 5).
   */
  async requestExport(
    user: User,
    staff: StaffUser | null = null
  ): Promise<{ request: PrivacyRequest; created: boolean }> {
    return db.transaction(async (trx) => {
      await User.query({ client: trx }).where('id', user.id).forUpdate().firstOrFail()

      /**
       * Self-service and staff-started exports are counted separately: they
       * go to different people, so one in progress does not stand in for the
       * other.
       */
      const active = await PrivacyRequest.query({ client: trx })
        .where('user_id', user.id)
        .where('type', 'export')
        .whereIn('status', ['requested', 'processing'])
        .if(
          staff,
          (query) => query.whereNotNull('requested_by_staff_id'),
          (query) => query.whereNull('requested_by_staff_id')
        )
        .first()

      if (active) {
        return { request: active, created: false }
      }

      const request = await PrivacyRequest.create(
        {
          userId: user.id,
          type: 'export',
          status: 'requested',
          requestedAt: DateTime.utc(),
          requestedByStaffId: staff?.id ?? null,
        },
        { client: trx }
      )

      /**
       * Queued in the same transaction, so there is never a request with no
       * job behind it, nor a job looking for a request that is not there yet.
       */
      const { default: generateJob } =
        await import('#modules/privacy/jobs/generate_privacy_export_job')
      await queue.dispatch(generateJob, { requestId: request.id }, { client: trx })

      return { request, created: true }
    })
  }

  /**
   * Build the archive for a request — the job's whole body. Safe to run
   * again: a finished request is left alone, and a half-finished one is
   * rebuilt over the same storage key.
   */
  async generate(requestId: number, isFinalAttempt: boolean): Promise<void> {
    const request = await PrivacyRequest.find(requestId)

    if (!request || !request.isExport || !['requested', 'processing'].includes(request.status)) {
      return
    }

    const user = await User.find(request.userId)

    if (!user || user.isDeleted) {
      request.merge({ status: 'failed', failureReason: 'The account no longer exists.' })
      await request.save()
      return
    }

    request.status = 'processing'
    request.startedAt = request.startedAt ?? DateTime.utc()
    await request.save()

    const key = `privacy/${request.publicId}.zip`
    let built: Awaited<ReturnType<typeof buildExport>> | null = null

    try {
      built = await buildExport(user, request.publicId)

      /**
       * Only for an export staff started: it is what their page shows. The
       * person's own export is never readable by staff, so no second copy of
       * it is kept.
       */
      if (request.isStaffInitiated) {
        await storage.moveFromTmp({
          tmpPath: built.dataPath,
          disk: 'private',
          key: dataKeyFor(request),
          contentType: 'application/json',
        })
      }

      await storage.moveFromTmp({
        tmpPath: built.path,
        disk: 'private',
        key,
        contentType: 'application/zip',
      })

      const ttlHours = await settings.get('privacy_export_ttl_hours')

      request.merge({
        status: 'completed',
        completedAt: DateTime.utc(),
        exportKey: key,
        exportSizeBytes: built.sizeBytes,
        exportExpiresAt: DateTime.utc().plus({ hours: ttlHours }),
        failureReason: null,
      })
      await request.save()
    } catch (error) {
      logger.error(
        { err: error, event: 'privacy.export.failed', request: request.publicId },
        'could not build a privacy export'
      )

      if (!isFinalAttempt) {
        throw error
      }

      request.merge({ status: 'failed', failureReason: FAILURE_REASON })
      await request.save()

      await audit.recordSystemAction({
        action: 'privacy.export.failed',
        organization: { id: user.organizationId },
        subjectType: 'PrivacyRequest',
        subjectId: request.publicId,
      })
      return
    } finally {
      await built?.cleanup()
    }

    await audit.recordSystemAction({
      action: 'privacy.export.generated',
      organization: { id: user.organizationId },
      subjectType: 'PrivacyRequest',
      subjectId: request.publicId,
      metadata: { sizeBytes: request.exportSizeBytes },
    })

    logger.info(
      { event: 'privacy.export.completed', request: request.publicId },
      'built a privacy export'
    )

    /**
     * A staff-started export is collected from its admin page; the person
     * is not emailed about an archive they cannot download.
     */
    if (!request.isStaffInitiated) {
      await mailer.send(new PrivacyExportReadyNotification(user, request))
    }
  }

  /**
   * Build an export staff have just asked for, there and then, so it is
   * ready when their page comes back rather than whenever a worker next
   * looks. The queued job stays as the safety net: if this attempt throws,
   * the job builds it again over the same storage key, and if it worked the
   * job finds a completed request and does nothing.
   */
  async generateNow(request: PrivacyRequest): Promise<boolean> {
    try {
      await this.generate(request.id, false)
    } catch {
      // Logged by `generate`; the queued job retries it.
    }

    await request.refresh()
    return request.status === 'completed'
  }

  /**
   * A short-lived signed URL for a downloadable export, and the stamp that
   * says it was fetched. The caller has already checked whose it is.
   */
  async downloadUrl(request: PrivacyRequest): Promise<string> {
    const date = request.completedAt?.toFormat('yyyy-LL-dd') ?? 'export'
    const appName = env
      .get('APP_NAME', 'Acme')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')

    const url = await storage.urlFor({
      disk: 'private',
      key: request.exportKey!,
      expiresIn: DOWNLOAD_LINK_TTL,
      downloadAs: `${appName}-data-${date}.zip`,
    })

    request.downloadedAt = request.downloadedAt ?? DateTime.utc()
    await request.save()

    return url
  }

  /**
   * The contents of a staff-started export's `data.json`, for its page. Null
   * when there is nothing to show — not staff-started, not finished, expired,
   * or built before the copy was kept. The caller has checked who is asking.
   */
  async reportView(request: PrivacyRequest): Promise<ReportView | null> {
    if (!request.isStaffInitiated || !request.isDownloadable) {
      return null
    }

    const object = { disk: 'private' as const, key: dataKeyFor(request) }

    if (!(await storage.exists(object))) {
      return null
    }

    const chunks: Buffer[] = []
    let size = 0

    for await (const chunk of await storage.stream(object)) {
      const bytes = Buffer.from(chunk)
      size += bytes.length

      if (size > REPORT_VIEW_LIMIT_BYTES) {
        return { tooLarge: true }
      }

      chunks.push(bytes)
    }

    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      exportedAt?: string
      data?: Record<string, unknown>
    }
    const described = new Map(registry.all().map((one) => [one.key, one.describes]))

    return {
      tooLarge: false,
      exportedAt: parsed.exportedAt ?? null,
      sections: Object.entries(parsed.data ?? {}).map(([key, value]) => ({
        key,
        describes: described.get(key) ?? null,
        json: JSON.stringify(value, null, 2),
      })),
    }
  }

  /**
   * The back-office list: newest first, every person's requests, with who
   * asked and which workspace they are in.
   */
  async adminPage(filter: AdminFilter, page: number) {
    const narrowing: { type?: string; statuses?: readonly string[] } = ADMIN_FILTERS[filter]
    const query = PrivacyRequest.query()
      .preload('user', (users) => users.preload('organization'))
      .orderBy('id', 'desc')

    if (narrowing.type) {
      query.where('type', narrowing.type)
    }

    if (narrowing.statuses) {
      query.whereIn('status', [...narrowing.statuses])
    }

    return query.paginate(page, 50)
  }

  /**
   * How many requests each filter would show, from one grouped query.
   */
  async adminCounts(): Promise<Record<AdminFilter, number>> {
    const rows = await PrivacyRequest.query()
      .select('type', 'status')
      .count('* as total')
      .groupBy('type', 'status')

    const counts = Object.fromEntries(Object.keys(ADMIN_FILTERS).map((key) => [key, 0])) as Record<
      AdminFilter,
      number
    >

    for (const row of rows) {
      const total = Number(row.$extras.total)

      for (const [key, narrowing] of Object.entries(ADMIN_FILTERS) as [
        AdminFilter,
        { type?: string; statuses?: readonly string[] },
      ][]) {
        const typeMatches = !narrowing.type || narrowing.type === row.type
        const statusMatches = !narrowing.statuses || narrowing.statuses.includes(row.status)

        if (typeMatches && statusMatches) {
          counts[key] += total
        }
      }
    }

    return counts
  }

  /**
   * The export staff generated for each of these people that is still worth
   * opening — being built, or built and not yet expired — newest first. What
   * turns a row's "Generate export" into "View report".
   */
  async staffReportsFor(userIds: number[]): Promise<Record<number, string>> {
    if (!userIds.length) {
      return {}
    }

    const exports = await PrivacyRequest.query()
      .whereIn('user_id', userIds)
      .where('type', 'export')
      .whereNotNull('requested_by_staff_id')
      .whereIn('status', ['requested', 'processing', 'completed'])
      .orderBy('id', 'desc')

    const reports: Record<number, string> = {}

    for (const one of exports) {
      if (!(one.userId in reports) && (one.isActive || one.isDownloadable)) {
        reports[one.userId] = one.publicId
      }
    }

    return reports
  }

  async findForStaff(publicId: string): Promise<PrivacyRequest | null> {
    return PrivacyRequest.query()
      .where('public_id', publicId)
      .preload('user', (users) => users.preload('organization'))
      .first()
  }

  /**
   * Everything the audit log holds about one request, oldest first — the
   * request's own history, for the detail screen.
   */
  async trail(request: PrivacyRequest): Promise<AuditLog[]> {
    return AuditLog.query()
      .where('subject_type', 'PrivacyRequest')
      .where('subject_id', request.publicId)
      .orderBy('id', 'asc')
  }

  /**
   * Try a failed export again. Only a failed export: one in progress is
   * already being worked, and a finished one is already there. Safe by
   * construction — the job rebuilds over the same storage key.
   */
  async retryExport(request: PrivacyRequest): Promise<void> {
    if (!request.isExport || request.status !== 'failed') {
      throw new PrivacyError('Only a failed export can be retried.')
    }

    const user = await User.find(request.userId)

    if (!user || user.isDeleted) {
      throw new PrivacyError('That account no longer exists, so there is nothing to export.')
    }

    await db.transaction(async (trx) => {
      request.useTransaction(trx)
      request.merge({ status: 'requested', failureReason: null, startedAt: null })
      await request.save()

      const { default: generateJob } =
        await import('#modules/privacy/jobs/generate_privacy_export_job')
      await queue.dispatch(generateJob, { requestId: request.id }, { client: trx })
    })
  }

  /**
   * Delete every export past its expiry, and mark it expired. The row stays —
   * only the archive goes.
   */
  async purgeExpired(): Promise<number> {
    const expired = await PrivacyRequest.query()
      .where('type', 'export')
      .where('status', 'completed')
      .whereNotNull('export_expires_at')
      .where('export_expires_at', '<=', DateTime.utc().toSQL()!)

    for (const request of expired) {
      if (request.exportKey) {
        /**
         * Already gone is fine: the goal is that it does not exist, and a
         * retry after a crash between the delete and the save lands here.
         */
        await storage.delete({ disk: 'private', key: request.exportKey }).catch(() => {})
      }

      if (request.isStaffInitiated) {
        await storage.delete({ disk: 'private', key: dataKeyFor(request) }).catch(() => {})
      }

      request.merge({ status: 'expired', exportKey: null })
      await request.save()

      await audit.recordSystemAction({
        action: 'privacy.export.purged',
        subjectType: 'PrivacyRequest',
        subjectId: request.publicId,
      })
    }

    return expired.length
  }
}

export default new PrivacyService()
