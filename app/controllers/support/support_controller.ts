import type { HttpContext } from '@adonisjs/core/http'

import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import files from '#storage/file_service'
import support, { SUPPORT_ATTACHMENT_LIMIT } from '#support/support_service'
import { UploadRejectedError } from '#storage/contracts'
import { openTicketValidator, replyValidator } from '#validators/support'

/**
 * Support, from the customer's side (plan §21.5).
 *
 * Reached from the account menu, not the sidebar: it is a thing you do about
 * the product rather than a place in it.
 *
 * Every action fetches through `SupportService`, which scopes by organisation
 * and by §21.4, and *then* asks the policy. Two layers on purpose — a scoping
 * bug should not be able to become an authorisation bug.
 */
export default class SupportController {
  async index({ view, auth, organization, bouncer }: HttpContext) {
    await bouncer.with('SupportTicketPolicy').authorize('viewAny', organization)

    const user = auth.use('web').user!

    return view.render('pages/support/index', {
      tickets: await support.forUser(organization, user),
    })
  }

  async create({ view, organization, bouncer }: HttpContext) {
    await bouncer.with('SupportTicketPolicy').authorize('create', organization)

    return view.render('pages/support/create', {
      attachmentLimit: SUPPORT_ATTACHMENT_LIMIT,
    })
  }

  async store(ctx: HttpContext) {
    const { request, response, session, auth, organization, bouncer } = ctx

    await bouncer.with('SupportTicketPolicy').authorize('create', organization)

    const data = await request.validateUsing(openTicketValidator)
    const user = auth.use('web').user!

    const { ticket, message } = await support.open(organization, user, data)

    try {
      await support.attach(organization, user, message, this.uploads(request))
    } catch (error) {
      /**
       * The ticket is already open at this point, and that is the right
       * outcome: the question reached us, and a rejected screenshot is a
       * message about the file, not a reason to lose what somebody typed.
       */
      if (error instanceof UploadRejectedError) {
        session.flash('error', error.message)

        return response.redirect().toRoute('support.show', { id: ticket.publicId })
      }

      throw error
    }

    await audit.recordUserAction(ctx, {
      action: AUDIT_ACTIONS.supportTicketOpened,
      subjectType: 'SupportTicket',
      subjectId: ticket.publicId,
      metadata: { subject: ticket.subject },
    })

    session.flash('success', 'Thanks — we have your message and will reply here.')

    return response.redirect().toRoute('support.show', { id: ticket.publicId })
  }

  async show({ params, view, session, response, auth, organization, bouncer }: HttpContext) {
    const user = auth.use('web').user!
    const ticket = await support.find(organization, user, params.id)

    if (!ticket) {
      session.flash('error', 'That ticket no longer exists.')
      return response.redirect().toRoute('support.index')
    }

    await bouncer.with('SupportTicketPolicy').authorize('view', ticket)

    return view.render('pages/support/show', {
      ticket,
      messages: await support.conversation(ticket),
      attachmentLimit: SUPPORT_ATTACHMENT_LIMIT,
    })
  }

  async reply({ params, request, response, session, auth, organization, bouncer }: HttpContext) {
    const user = auth.use('web').user!
    const ticket = await support.find(organization, user, params.id)

    if (!ticket) {
      session.flash('error', 'That ticket no longer exists.')
      return response.redirect().toRoute('support.index')
    }

    await bouncer.with('SupportTicketPolicy').authorize('reply', ticket)

    const { body } = await request.validateUsing(replyValidator)
    const message = await support.replyAsUser(ticket, user, body)

    try {
      await support.attach(organization, user, message, this.uploads(request))
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        session.flash('error', error.message)

        return response.redirect().toRoute('support.show', { id: ticket.publicId })
      }

      throw error
    }

    return response.redirect().toRoute('support.show', { id: ticket.publicId })
  }

  /**
   * Hand the browser a URL for an attachment.
   *
   * The ticket is authorised first and the signed URL is minted second, so
   * the grant never exists for somebody who was not allowed to read the
   * conversation it hangs off (plan §21.3).
   */
  async attachment({
    params,
    response,
    session,
    auth,
    organization,
    bouncer,
    request,
  }: HttpContext) {
    const user = auth.use('web').user!
    const ticket = await support.find(organization, user, params.id)

    if (!ticket) {
      session.flash('error', 'That ticket no longer exists.')
      return response.redirect().toRoute('support.index')
    }

    await bouncer.with('SupportTicketPolicy').authorize('view', ticket)

    const file = await support.attachment(ticket, params.fileId)

    if (!file) {
      session.flash('error', 'That attachment is no longer there.')
      return response.redirect().toRoute('support.show', { id: ticket.publicId })
    }

    const url = await files.urlFor(file, { download: request.input('download') === '1' })

    /**
     * `clearQs()` for the same reason the files screen needs it: a forwarded
     * query string appended after a signature is not what was signed.
     */
    return response.redirect().clearQs().toPath(url)
  }

  /**
   * The files that came with the form, capped. `request.files()` returns
   * everything under the field name; anything past the limit is dropped here
   * rather than uploaded and then refused.
   */
  private uploads(request: HttpContext['request']) {
    return request
      .files('attachments', { size: '5mb' })
      .filter((file) => Boolean(file.tmpPath))
      .slice(0, SUPPORT_ATTACHMENT_LIMIT)
      .map((file) => ({
        tmpPath: file.tmpPath!,
        clientName: file.clientName,
        sizeBytes: file.size,
      }))
  }
}
