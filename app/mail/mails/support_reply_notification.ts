import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type SupportTicket from '#models/support_ticket'

/**
 * Tells the customer somebody answered (plan §21.7).
 *
 * A notification with a link, not a thread: replying to this email does
 * nothing, and the template says so. Inbound parsing is a provider webhook
 * and a spam surface, deliberately out of v1 (§21.11).
 */
export default class SupportReplyNotification extends BaseMail {
  constructor(
    private recipient: User,
    private ticket: SupportTicket,
    private body: string
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('support.show', { id: this.ticket.publicId })}`

    this.message
      .to(this.recipient.email)
      .subject(`Re: ${this.ticket.subject}`)
      .htmlView('emails/support_reply', {
        recipient: this.recipient,
        ticket: this.ticket,
        body: this.body,
        url,
      })
      .textView('emails/support_reply_text', {
        recipient: this.recipient,
        ticket: this.ticket,
        body: this.body,
        url,
      })
  }
}
