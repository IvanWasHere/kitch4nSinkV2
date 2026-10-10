import type { HttpContext } from '@adonisjs/core/http'

import audit from '#audit/audit_service'
import privacy, {
  ADMIN_FILTERS,
  PrivacyError,
  type AdminFilter,
} from '#modules/privacy/services/privacy_service'
import deletion from '#modules/privacy/services/deletion_service'
import {
  rejectDeletionValidator,
  staffDeletionValidator,
  staffExportValidator,
} from '#modules/privacy/validators'
import User from '#models/user'
import type StaffUser from '#models/staff_user'
import type PrivacyRequest from '#modules/privacy/models/privacy_request'
import '#modules/privacy/audit_actions'

/**
 * Admin → Privacy requests (plan §22.8.3).
 *
 * Support and admin can both see every request and retry a failed export —
 * retrying is idempotent, the same reasoning as replaying a job
 * (`StaffPolicy.replay`). Nobody here can download an export: a copy of a
 * customer's whole account is for that customer, and staff reading customer
 * data have their own audited screens.
 */
export default class AdminPrivacyController {
  async index({ request, view, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const requested = String(request.input('filter', 'all'))
    const filter = (requested in ADMIN_FILTERS ? requested : 'all') as AdminFilter
    const page = Math.max(1, Number.parseInt(String(request.input('page', 1)), 10) || 1)

    const [requests, counts] = await Promise.all([
      privacy.adminPage(filter, page),
      privacy.adminCounts(),
    ])

    const rows = requests.all()
    const canExport = await staffBouncer.with('StaffPolicy').allows('exportPersonalData')
    const pageUrl = (target: number) =>
      `?${new URLSearchParams({ ...(filter === 'all' ? {} : { filter }), page: String(target) })}`
    const first = (requests.currentPage - 1) * requests.perPage + 1

    return view.render('pages/privacy/admin/index', {
      requests: rows,
      counts,
      filter,
      filters: Object.keys(ADMIN_FILTERS),
      canExport,
      canErase: await staffBouncer.with('StaffPolicy').allows('eraseAccounts'),
      reports: canExport ? await privacy.staffReportsFor(rows.map((one) => one.userId)) : {},
      summary: rows.length
        ? `Showing ${first}–${first + rows.length - 1} of ${requests.total}`
        : '',
      prevUrl: requests.currentPage > 1 ? pageUrl(requests.currentPage - 1) : null,
      nextUrl: requests.hasMorePages ? pageUrl(requests.currentPage + 1) : null,
    })
  }

  async show(ctx: HttpContext) {
    const { params, view, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('view')

    const request = await privacy.findForStaff(params.id)

    if (!request) {
      session.flash('error', 'That request no longer exists.')
      return response.redirect().toRoute('admin.privacy.index')
    }

    /**
     * What approving would do, worked out now — the admin decides on this,
     * not on what was true when the person asked.
     */
    const awaitingDecision =
      request.type === 'deletion' && ['requested', 'confirmed'].includes(request.status)

    /**
     * An export an admin generated shows its `data.json` here. That is
     * reading somebody's personal data, so it is admin only and every view
     * is audited, the same as a download.
     */
    const canExport = await staffBouncer.with('StaffPolicy').allows('exportPersonalData')
    const report = canExport ? await privacy.reportView(request) : null

    if (report) {
      await audit.recordStaffAction(ctx, {
        action: 'privacy.export.viewed',
        organization: request.user ? { id: request.user.organizationId } : null,
        subjectType: 'PrivacyRequest',
        subjectId: request.publicId,
      })
    }

    return view.render('pages/privacy/admin/show', {
      privacyRequest: request,
      report,
      trail: await privacy.trail(request),
      review: awaitingDecision ? await deletion.review(request) : null,
      canErase: await staffBouncer.with('StaffPolicy').allows('eraseAccounts'),
      canExport,
    })
  }

  async approve(ctx: HttpContext) {
    return this.decide(ctx, 'privacy.deletion.approved', async (request, staff) => {
      await deletion.approve(request, staff)
      return (await deletion.runNow(request))
        ? 'The account has been deleted.'
        : 'Approved. The deletion did not finish straight away and will be tried again in the background.'
    })
  }

  async reject(ctx: HttpContext) {
    const { reason } = await ctx.request.validateUsing(rejectDeletionValidator)

    return this.decide(
      ctx,
      'privacy.deletion.rejected',
      async (request, staff) => {
        await deletion.reject(request, staff, reason)
        return 'Rejected. The person has been emailed the reason.'
      },
      { reason }
    )
  }

  /**
   * The admin-only actions on a deletion share one shape: authorise, find,
   * act, audit, and go back to the request.
   */
  private async decide(
    ctx: HttpContext,
    action: 'privacy.deletion.approved' | 'privacy.deletion.rejected' | 'privacy.deletion.retried',
    run: (request: PrivacyRequest, staff: StaffUser) => Promise<string>,
    metadata: Record<string, unknown> = {}
  ) {
    const { params, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('eraseAccounts')

    const request = await privacy.findForStaff(params.id)

    if (!request) {
      session.flash('error', 'That request no longer exists.')
      return response.redirect().toRoute('admin.privacy.index')
    }

    let message: string

    try {
      message = await run(request, auth.use('staff').user!)
    } catch (error) {
      if (error instanceof PrivacyError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('admin.privacy.show', { id: request.publicId })
      }

      throw error
    }

    await audit.recordStaffAction(ctx, {
      action,
      organization: request.user ? { id: request.user.organizationId } : null,
      subjectType: 'PrivacyRequest',
      subjectId: request.publicId,
      metadata,
    })

    session.flash('success', message)
    return response.redirect().toRoute('admin.privacy.show', { id: request.publicId })
  }

  async retry(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx

    const request = await privacy.findForStaff(params.id)

    if (!request) {
      await staffBouncer.with('StaffPolicy').authorize('view')
      session.flash('error', 'That request no longer exists.')
      return response.redirect().toRoute('admin.privacy.index')
    }

    /**
     * Retrying a deletion runs the deletion — admin only, like approving it.
     */
    if (request.type === 'deletion') {
      return this.decide(ctx, 'privacy.deletion.retried', async (one, staff) => {
        await deletion.retry(one, staff)
        return (await deletion.runNow(one))
          ? 'The account has been deleted.'
          : 'The deletion has been queued again.'
      })
    }

    await staffBouncer.with('StaffPolicy').authorize('replay')

    try {
      await privacy.retryExport(request)
    } catch (error) {
      if (error instanceof PrivacyError) {
        session.flash('error', error.message)
        return response.redirect().back()
      }

      throw error
    }

    await audit.recordStaffAction(ctx, {
      action: 'privacy.export.retried',
      organization: request.user ? { id: request.user.organizationId } : null,
      subjectType: 'PrivacyRequest',
      subjectId: request.publicId,
    })

    session.flash(
      'success',
      (await privacy.generateNow(request))
        ? 'The export has been built.'
        : 'The export has been queued again.'
    )
    return response.redirect().toRoute('admin.privacy.show', { id: request.publicId })
  }

  /**
   * Generate a copy of somebody's data on their behalf (plan §22.8) — for a
   * request that arrived by email or ticket. Admin only. The archive is for
   * the admin to download from the request's page; the person is not emailed
   * and does not see it on their own Privacy screen.
   */
  async startExport(ctx: HttpContext) {
    const { request, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('exportPersonalData')

    const { user: publicId } = await request.validateUsing(staffExportValidator)
    const user = await User.findBy('public_id', publicId)

    if (!user || user.isDeleted) {
      session.flash('error', 'That account does not exist or has been deleted.')
      return response.redirect().back()
    }

    const { request: privacyRequest, created } = await privacy.requestExport(
      user,
      auth.use('staff').user!
    )

    if (created) {
      await audit.recordStaffAction(ctx, {
        action: 'privacy.export.started_by_staff',
        organization: { id: user.organizationId },
        subjectType: 'PrivacyRequest',
        subjectId: privacyRequest.publicId,
        metadata: { email: user.email },
      })
    }

    /**
     * Built now, not left for a worker — also when one was already waiting,
     * which is how a click finishes an export that got stuck in the queue.
     */
    const ready = await privacy.generateNow(privacyRequest)

    session.flash(
      'success',
      ready
        ? 'The export is ready.'
        : 'The export could not be built straight away and will be tried again in the background.'
    )
    return response.redirect().toRoute('admin.privacy.show', { id: privacyRequest.publicId })
  }

  /**
   * Download a staff-started export. Re-checks everything, then hands out a
   * link that lasts minutes. Self-service exports are never downloadable
   * here — they are only ever handed to the person.
   */
  async download(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('exportPersonalData')

    const privacyRequest = await privacy.findForStaff(params.id)

    if (!privacyRequest || !privacyRequest.isExport || !privacyRequest.isStaffInitiated) {
      return response.notFound()
    }

    if (!privacyRequest.isDownloadable) {
      session.flash('error', 'That export is not available to download.')
      return response.redirect().toRoute('admin.privacy.show', { id: privacyRequest.publicId })
    }

    const url = await privacy.downloadUrl(privacyRequest)

    await audit.recordStaffAction(ctx, {
      action: 'privacy.export.downloaded',
      organization: privacyRequest.user ? { id: privacyRequest.user.organizationId } : null,
      subjectType: 'PrivacyRequest',
      subjectId: privacyRequest.publicId,
    })

    return response.redirect().clearQs().toPath(url)
  }

  /**
   * The confirmation page for deleting somebody's account on their behalf.
   * Shows what approving would do — worked out now — before asking.
   */
  async newDeletion({ request, view, response, session, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('eraseAccounts')

    const user = await User.query()
      .where('public_id', String(request.input('user', '')))
      .preload('organization')
      .first()

    if (!user || user.isDeleted) {
      session.flash('error', 'That account does not exist or has been deleted.')
      return response.redirect().toRoute('admin.users.index')
    }

    return view.render('pages/privacy/admin/new_deletion', {
      person: user,
      review: await deletion.reviewUser(user),
      activeDeletion: await deletion.active(user),
    })
  }

  async startDeletion(ctx: HttpContext) {
    const { request, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('eraseAccounts')

    const payload = await request.validateUsing(staffDeletionValidator)
    const user = await User.findBy('public_id', payload.user)

    if (!user) {
      session.flash('error', 'That account does not exist.')
      return response.redirect().toRoute('admin.users.index')
    }

    /**
     * Typing the address is the confirmation. It has to be the account's
     * own address, exactly — a near miss is a sign the admin is looking at
     * the wrong person.
     */
    if (payload.confirmEmail !== user.email.toLowerCase()) {
      session.flash('error', 'The address you typed does not match this account.')
      session.flashExcept(['confirmEmail'])
      return response.redirect().back()
    }

    let started: PrivacyRequest

    try {
      started = await deletion.startByStaff(user, auth.use('staff').user!, payload.reason)
    } catch (error) {
      if (error instanceof PrivacyError) {
        session.flash('error', error.message)
        return response.redirect().back()
      }

      throw error
    }

    await audit.recordStaffAction(ctx, {
      action: 'privacy.deletion.started_by_staff',
      organization: { id: user.organizationId },
      subjectType: 'PrivacyRequest',
      subjectId: started.publicId,
      metadata: { email: user.email, reason: payload.reason },
    })

    session.flash(
      'success',
      (await deletion.runNow(started))
        ? 'The account has been deleted.'
        : 'The deletion did not finish straight away and will be tried again in the background.'
    )
    return response.redirect().toRoute('admin.privacy.show', { id: started.publicId })
  }
}
