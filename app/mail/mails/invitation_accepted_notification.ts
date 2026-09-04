import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type Organization from '#models/organization'

/**
 * Tells the owner someone joined. It is also how they find out if an
 * invitation was accepted by an address they did not expect.
 */
export default class InvitationAcceptedNotification extends BaseMail {
  constructor(
    private recipient: User,
    private joiner: User,
    private organization: Organization
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('members.index')}`

    this.message
      .to(this.recipient.email)
      .subject(`${this.joiner.displayName} joined ${this.organization.name}`)
      .htmlView('emails/invitation_accepted', {
        joiner: this.joiner,
        organization: this.organization,
        url,
      })
      .textView('emails/invitation_accepted_text', {
        joiner: this.joiner,
        organization: this.organization,
        url,
      })
  }
}
