import type { HttpContext } from '@adonisjs/core/http'

import audit, { type AuditAction } from '#audit/audit_service'
import type WaitingListEntry from '#modules/registration_control/models/waiting_list_entry'
import waitingList, {
  WAITING_LIST_STATUSES,
  WaitingListError,
  type WaitingListStatus,
} from '#modules/registration_control/services/waiting_list_service'
import '#modules/registration_control/audit_actions'

/**
 * Admin → Waiting list (plan §22.5).
 *
 * Support **and** admin, like the user screen it sits beside: every action
 * here concerns one person who is not yet a customer, and cancelling or
 * re-sending is the kind of fix support exists to make. Changing whether
 * registration is open at all stays admin-only, on the settings screen.
 */
export default class WaitingListAdminController {
  async index({ request, view, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const requested = String(request.input('status', ''))
    const status = (WAITING_LIST_STATUSES as readonly string[]).includes(requested)
      ? (requested as WaitingListStatus)
      : null

    const page = Math.max(1, Number.parseInt(String(request.input('page', 1)), 10) || 1)

    const [entries, counts] = await Promise.all([
      waitingList.page({ status, page }),
      waitingList.counts(),
    ])

    const rows = entries.all()
    const first = (entries.currentPage - 1) * entries.perPage + 1

    const pageUrl = (target: number) =>
      `?${new URLSearchParams({ ...(status ? { status } : {}), page: String(target) })}`

    return view.render('pages/registration_control/admin_waiting_list', {
      entries: rows,
      counts,
      status,
      statuses: WAITING_LIST_STATUSES,
      summary: rows.length ? `Showing ${first}–${first + rows.length - 1} of ${entries.total}` : '',
      prevUrl: entries.currentPage > 1 ? pageUrl(entries.currentPage - 1) : null,
      nextUrl: entries.hasMorePages ? pageUrl(entries.currentPage + 1) : null,
    })
  }

  async cancel(ctx: HttpContext) {
    return this.act(ctx, 'waitlist.cancelled', (entry) => waitingList.cancel(entry), 'Cancelled')
  }

  async convert(ctx: HttpContext) {
    return this.act(
      ctx,
      'waitlist.converted',
      (entry) => waitingList.markConverted(entry),
      'Marked as converted:'
    )
  }

  async resend(ctx: HttpContext) {
    return this.act(
      ctx,
      'waitlist.resent',
      (entry) => waitingList.resendConfirmation(entry),
      'Confirmation email queued for'
    )
  }

  async destroy(ctx: HttpContext) {
    return this.act(ctx, 'waitlist.deleted', (entry) => waitingList.delete(entry), 'Deleted')
  }

  /**
   * The shape every action shares: find the entry, do the thing, audit it,
   * and go back to the list where the reader was. A refused action (a
   * cancelled entry cannot be converted, say) is a flash, not a 500.
   */
  private async act(
    ctx: HttpContext,
    action: AuditAction,
    run: (entry: WaitingListEntry) => Promise<void>,
    done: string
  ) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('assistUser')

    const entry = await waitingList.findByPublicId(params.id)

    if (!entry) {
      session.flash('error', 'That entry no longer exists.')
      return response.redirect().back()
    }

    const before = entry.status

    try {
      await run(entry)
    } catch (error) {
      if (error instanceof WaitingListError) {
        session.flash('error', error.message)
        return response.redirect().back()
      }

      throw error
    }

    await audit.recordStaffAction(ctx, {
      action,
      subjectType: 'WaitingListEntry',
      subjectId: entry.publicId,
      metadata: {
        email: entry.email,
        from: before,
        to: action === 'waitlist.deleted' ? null : entry.status,
      },
    })

    session.flash('success', `${done} ${entry.email}.`)
    return response.redirect().back()
  }
}
