import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'

import File from '#models/file'
import files from '#storage/file_service'
import { UploadRejectedError } from '#storage/contracts'
import type User from '#models/user'
import type StaffUser from '#models/staff_user'
import type Organization from '#models/organization'
import SupportTicket from '#models/support_ticket'
import SupportMessage from '#models/support_message'

export interface OpenTicketData {
  subject: string
  body: string
}

export interface IncomingAttachment {
  tmpPath: string
  clientName: string
  sizeBytes: number
}

/**
 * Attachment rules, tighter than the application's general upload rules
 * (plan §21.3). A support ticket wants a screenshot, not a data set: three
 * files, 5 MB each, images and PDF only.
 */
export const SUPPORT_ATTACHMENT_LIMIT = 3
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
export const SUPPORT_ATTACHMENT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf'] as const

/**
 * Support conversations (plan §21).
 *
 * Two rules live here and nowhere else:
 *
 *   1. **Scope.** A ticket belongs to an organisation, and inside it to the
 *      author and the owners (§21.4). Every read below goes through
 *      `scopeFor`, so there is one place to get that wrong rather than one
 *      per controller action.
 *   2. **State.** `open` is waiting on us, `answered` is waiting on them, and
 *      a reply to a `resolved` ticket reopens it. No caller sets `status`
 *      directly; they call `reply` or `resolve` and the transition follows
 *      from who is speaking (§21.2).
 */
export class SupportService {
  /**
   * The tickets this user may see, newest activity first.
   *
   * Owners see the whole workspace's tickets because they are already its
   * billing and membership authority; a member sees their own. A support
   * ticket can carry a billing dispute or a complaint about a colleague,
   * which is why this is narrower than the workspace-wide rule lists follow
   * (D8, §21.4).
   */
  private scopeFor(organization: Organization, user: User) {
    const query = SupportTicket.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')

    if (!user.isOwner) {
      query.where('created_by_user_id', user.id)
    }

    return query
  }

  async forUser(organization: Organization, user: User): Promise<SupportTicket[]> {
    return this.scopeFor(organization, user).orderBy('last_message_at', 'desc').limit(100)
  }

  async find(
    organization: Organization,
    user: User,
    publicId: string
  ): Promise<SupportTicket | null> {
    return this.scopeFor(organization, user).where('public_id', publicId).first()
  }

  /**
   * How many of this user's tickets are waiting on them — the count beside
   * *Support* in the account menu.
   *
   * Derived from the status rather than from a `seen_at` column: `answered`
   * already means "staff replied and the customer has not come back"
   * (§21.7).
   */
  async awaitingCustomerCount(organization: Organization, user: User): Promise<number> {
    const [row] = await this.scopeFor(organization, user)
      .where('status', 'answered')
      .count('* as total')

    return Number(row.$extras.total)
  }

  /**
   * A message and its attachments, oldest first — the only way a
   * conversation is ever read.
   */
  async conversation(ticket: SupportTicket): Promise<SupportMessage[]> {
    const messages = await SupportMessage.query()
      .where('support_ticket_id', ticket.id)
      .preload('authorUser')
      .preload('authorStaff')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')

    const attachments = await File.query()
      .where('attachable_type', 'SupportMessage')
      .whereIn(
        'attachable_id',
        messages.map((message) => message.id)
      )
      .whereNull('deleted_at')

    for (const message of messages) {
      message.$setRelated(
        'attachments',
        attachments.filter((file) => file.attachableId === message.id)
      )
    }

    return messages
  }

  /**
   * Open a ticket. The subject and the first message are one action for the
   * customer, so they are one transaction here.
   */
  async open(
    organization: Organization,
    author: User,
    data: OpenTicketData
  ): Promise<{ ticket: SupportTicket; message: SupportMessage }> {
    return db.transaction(async (trx) => {
      const now = DateTime.utc()

      const ticket = await SupportTicket.create(
        {
          organizationId: organization.id,
          createdByUserId: author.id,
          subject: data.subject.trim(),
          status: 'open',
          lastMessageAt: now,
        },
        { client: trx }
      )

      const message = await SupportMessage.create(
        {
          supportTicketId: ticket.id,
          authorType: 'user',
          authorUserId: author.id,
          body: data.body.trim(),
        },
        { client: trx }
      )

      return { ticket, message }
    })
  }

  /**
   * The customer replies. Whatever the ticket was, it is now waiting on us —
   * including a resolved one, which is how reopening works (§21.2).
   */
  async replyAsUser(ticket: SupportTicket, author: User, body: string): Promise<SupportMessage> {
    return db.transaction(async (trx) => {
      const message = await SupportMessage.create(
        {
          supportTicketId: ticket.id,
          authorType: 'user',
          authorUserId: author.id,
          body: body.trim(),
        },
        { client: trx }
      )

      ticket.useTransaction(trx)
      ticket.status = 'open'
      ticket.lastMessageAt = DateTime.utc()
      ticket.resolvedAt = null
      await ticket.save()

      return message
    })
  }

  /**
   * Staff reply. This is also the only place `first_responded_at` is
   * written: stamped on the first staff message and never moved, because
   * "how long until somebody answered" is a fact about the first answer.
   */
  async replyAsStaff(
    ticket: SupportTicket,
    author: StaffUser,
    body: string
  ): Promise<SupportMessage> {
    return db.transaction(async (trx) => {
      const message = await SupportMessage.create(
        {
          supportTicketId: ticket.id,
          authorType: 'staff',
          authorStaffId: author.id,
          body: body.trim(),
        },
        { client: trx }
      )

      const now = DateTime.utc()

      ticket.useTransaction(trx)
      ticket.status = 'answered'
      ticket.lastMessageAt = now
      ticket.firstRespondedAt = ticket.firstRespondedAt ?? now
      ticket.resolvedAt = null
      await ticket.save()

      return message
    })
  }

  /**
   * Store the files that came with a message.
   *
   * Uploaded through `FileService` so the checksum, the content sniffing and
   * the object key convention are the ones the rest of the application uses
   * — the only difference is that these do not count against the storage cap
   * (§21.3), and that they are always private.
   */
  async attach(
    organization: Organization,
    actor: User,
    message: SupportMessage,
    incoming: IncomingAttachment[]
  ): Promise<File[]> {
    const stored: File[] = []

    for (const attachment of incoming.slice(0, SUPPORT_ATTACHMENT_LIMIT)) {
      if (attachment.sizeBytes > SUPPORT_ATTACHMENT_MAX_BYTES) {
        throw new UploadRejectedError(
          `Attachments are limited to ${File.formatBytes(SUPPORT_ATTACHMENT_MAX_BYTES)} each.`,
          'too_large'
        )
      }

      const extension = attachment.clientName.split('.').pop()?.toLowerCase() ?? ''

      if (!(SUPPORT_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
        throw new UploadRejectedError(
          'Attach an image or a PDF — those are the ones we can open.',
          'extension_not_allowed'
        )
      }

      stored.push(
        await files.upload(organization, actor, {
          tmpPath: attachment.tmpPath,
          clientName: attachment.clientName,
          sizeBytes: attachment.sizeBytes,
          disk: 'private',
          skipQuota: true,
          attachTo: { type: 'SupportMessage', id: message.id },
        })
      )
    }

    return stored
  }

  /**
   * One attachment, if it belongs to a message on this ticket.
   *
   * Authorising by ticket and not by file id is the point: a signed URL is
   * minted only after the caller has been shown to be allowed to read the
   * conversation the file hangs off (§21.3).
   */
  async attachment(ticket: SupportTicket, filePublicId: string): Promise<File | null> {
    const messageIds = await SupportMessage.query()
      .where('support_ticket_id', ticket.id)
      .select('id')

    if (messageIds.length === 0) {
      return null
    }

    return File.query()
      .where('public_id', filePublicId)
      .where('attachable_type', 'SupportMessage')
      .whereIn(
        'attachable_id',
        messageIds.map((message) => message.id)
      )
      .whereNull('deleted_at')
      .first()
  }

  async resolve(ticket: SupportTicket): Promise<void> {
    ticket.status = 'resolved'
    ticket.resolvedAt = DateTime.utc()
    await ticket.save()
  }

  async assign(ticket: SupportTicket, staff: StaffUser | null): Promise<void> {
    ticket.assignedStaffId = staff?.id ?? null
    await ticket.save()
  }

  /* ---------------------------------------------------------------- staff */

  /**
   * The back-office queue. Cross-tenant by design — that is the job — so
   * this is the one read here that does not take an organisation.
   */
  async queue(
    options: { status?: 'open' | 'answered' | 'resolved' } = {}
  ): Promise<SupportTicket[]> {
    const query = SupportTicket.query()
      .whereNull('deleted_at')
      .preload('organization')
      .preload('createdBy')
      .preload('assignedStaff')

    if (options.status) {
      query.where('status', options.status)
    }

    /**
     * Oldest activity first for the open queue: the ticket nobody has
     * answered is the one that should be at the top, not the newest.
     */
    return query
      .orderByRaw(`case when status = 'open' then 0 else 1 end`)
      .orderBy('last_message_at', options.status === 'open' ? 'asc' : 'desc')
      .limit(100)
  }

  async findForStaff(publicId: string): Promise<SupportTicket | null> {
    return SupportTicket.query()
      .where('public_id', publicId)
      .whereNull('deleted_at')
      .preload('organization')
      .preload('createdBy')
      .preload('assignedStaff')
      .first()
  }

  async counts(): Promise<{ open: number; answered: number; resolved: number }> {
    const rows = await SupportTicket.query()
      .whereNull('deleted_at')
      .select('status')
      .count('* as total')
      .groupBy('status')

    const counts = { open: 0, answered: 0, resolved: 0 }

    for (const row of rows) {
      const status = row.status as keyof typeof counts
      counts[status] = Number(row.$extras.total)
    }

    return counts
  }
}

export default new SupportService()
