import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type Invitation from '#models/invitation'
import type Organization from '#models/organization'

/**
 * The invitation link is a credential for somebody else's workspace, so the
 * message names who sent it and which workspace it opens — an unexpected
 * invitation should be obviously ignorable.
 */
export default class TeamInvitationNotification extends BaseMail {
  constructor(
    private invitation: Invitation,
    private organization: Organization,
    private invitedBy: User,
    private token: string
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('invitations.show', { token: this.token })}`

    this.message
      .to(this.invitation.email)
      .subject(`${this.invitedBy.displayName} invited you to ${this.organization.name}`)
      .htmlView('emails/team_invitation', {
        organization: this.organization,
        invitedBy: this.invitedBy,
        invitation: this.invitation,
        url,
      })
      .textView('emails/team_invitation_text', {
        organization: this.organization,
        invitedBy: this.invitedBy,
        invitation: this.invitation,
        url,
      })
  }
}
