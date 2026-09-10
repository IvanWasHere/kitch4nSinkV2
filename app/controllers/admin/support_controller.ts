import type { HttpContext } from '@adonisjs/core/http'

import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import files from '#storage/file_service'
import mailer from '#mail/mailer_service'
import support from '#support/support_service'
import SupportReplyNotification from '#mail/mails/support_reply_notification'
import { replyValidator } from '#validators/support'

const STATUSES = ['open', 'answered', 'resolved'] as const

/**
 * Support, from behind the counter (plan §21.5).
 *
 * The mockup's two-pane layout: the queue on the left, one conversation on
 * the right. Cross-tenant by design — this is the one screen whose job is to
 * look at every workspace at once — so each row says which workspace it came
 * from and links to that organisation's detail screen.
 */
export default class AdminSupportController {
  async index({ request, view, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const requested = String(request.input('status', 'open'))
    const status = (STATUSES as readonly string[]).includes(requested)
      ? (requested as (typeof STATUSES)[number])
      : 'open'

    const [tickets, counts] = await Promise.all([support.queue({ status }), support.counts()])

    return view.render('pages/admin/support/index', {
      tickets,
      counts,
      status,
      statuses: STATUSES,
      ticket: null,
      messages: [],
    })
  }

  async show({ params, request, view, response, session, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const ticket = await support.findForStaff(params.id)

    if (!ticket) {
      session.flash('error', 'That ticket no longer exists.')
      return response.redirect().toRoute('admin.support.index')
    }

    /**
     * The list beside the conversation keeps whatever filter the queue was
     * on, so opening a ticket does not lose the reader's place.
     */
    const requested = String(request.input('status', ticket.status))
    const status = (STATUSES as readonly string[]).includes(requested)
      ? (requested as (typeof STATUSES)[number])
      : ticket.status

    const [tickets, counts, messages] = await Promise.all([
      support.queue({ status }),
      support.counts(),
      support.conversation(ticket),
    ])

    return view.render('pages/admin/support/index', {
      tickets,
      counts,
      status,
      statuses: STATUSES,
      ticket,
      messages,
    })
  }

  /**
   * The screenshot the customer attached. Staff not being able to open it
   * would defeat the point of letting them send it (plan §21.3) — the check
   * is the same shape as the tenant side's: authorise the ticket, then mint
   * the signed URL.
   */
  async attachment({ params, request, response, session, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const ticket = await support.findForStaff(params.id)

    if (!ticket) {
      session.flash('error', 'That ticket no longer exists.')
      return response.redirect().toRoute('admin.support.index')
    }

    const file = await support.attachment(ticket, params.fileId)

    if (!file) {
      session.flash('error', 'That attachment is no longer there.')
      return response.redirect().toRoute('admin.support.show', { id: ticket.publicId })
    }

    const url = await files.urlFor(file, { download: request.input('download') === '1' })

    return response.redirect().clearQs().toPath(url)
  }

  async reply(ctx: HttpContext) {
    const { params, request, response, session, auth, staffBouncer } = ctx

    await staffBouncer.with('StaffPolicy').authorize('answerSupport')

    const ticket = await support.findForStaff(params.id)

    if (!ticket) {
      session.flash('error', 'That ticket no longer exists.')
      return response.redirect().toRoute('admin.support.index')
    }

    const { body } = await request.validateUsing(replyValidator)
    const staff = auth.use('staff').user!

    await support.replyAsStaff(ticket, staff, body)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.supportReplied,
      subjectType: 'SupportTicket',
      subjectId: ticket.publicId,
      organization: { id: ticket.organizationId },
    })

    /**
     * The customer is told by email, because they are not sitting on this
     * screen waiting. It carries the reply and a link; replying to it does
     * nothing, and §21.11 says what inbound email would cost.
     */
    await ticket.load('createdBy')

    if (ticket.createdBy) {
      await mailer.send(new SupportReplyNotification(ticket.createdBy, ticket, body))
    }

    session.flash('success', 'Reply sent.')

    return response.redirect().toRoute('admin.support.show', { id: ticket.publicId })
  }

  async resolve(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx

    await staffBouncer.with('StaffPolicy').authorize('answerSupport')

    const ticket = await support.findForStaff(params.id)

    if (!ticket) {
      session.flash('error', 'That ticket no longer exists.')
      return response.redirect().toRoute('admin.support.index')
    }

    await support.resolve(ticket)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.supportResolved,
      subjectType: 'SupportTicket',
      subjectId: ticket.publicId,
      organization: { id: ticket.organizationId },
    })

    session.flash('success', 'Marked resolved. A reply from either side reopens it.')

    return response.redirect().toRoute('admin.support.show', { id: ticket.publicId })
  }

  /**
   * "I am dealing with this one." Assignment is a note to other staff, not a
   * permission: anybody who can answer can still answer.
   */
  async assign(ctx: HttpContext) {
    const { params, request, response, session, auth, staffBouncer } = ctx

    await staffBouncer.with('StaffPolicy').authorize('answerSupport')

    const ticket = await support.findForStaff(params.id)

    if (!ticket) {
      session.flash('error', 'That ticket no longer exists.')
      return response.redirect().toRoute('admin.support.index')
    }

    const staff = auth.use('staff').user!
    const claiming = request.input('assign') !== 'none'

    await support.assign(ticket, claiming ? staff : null)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.supportAssigned,
      subjectType: 'SupportTicket',
      subjectId: ticket.publicId,
      organization: { id: ticket.organizationId },
      metadata: { assigned: claiming ? staff.email : null },
    })

    return response.redirect().toRoute('admin.support.show', { id: ticket.publicId })
  }
}
