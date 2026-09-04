import type { HttpContext } from '@adonisjs/core/http'

import Invitation from '#models/invitation'
import mailer from '#mail/mailer_service'
import invitations, { InvitationError } from '#organizations/invitation_service'
import TeamInvitationNotification from '#mail/mails/team_invitation_notification'
import { parsePublicId } from '#models/public_id'

/**
 * Owner-only actions on outstanding invitations.
 */
export default class InvitationController {
  async revoke({ params, response, session, organization, bouncer }: HttpContext) {
    const invitation = await this.find(params.id, organization.id)

    if (!invitation) {
      session.flash('error', 'That invitation no longer exists.')
      return response.redirect().toRoute('members.index')
    }

    await bouncer.with('InvitationPolicy').authorize('revoke', invitation)
    await invitations.revoke(invitation)

    session.flash('success', `The invitation to ${invitation.email} has been revoked.`)
    return response.redirect().toRoute('members.index')
  }

  /**
   * Resending issues a *new* token and retires the old one, so a link that
   * was forwarded to the wrong person stops working.
   */
  async resend({ params, response, session, auth, organization, bouncer }: HttpContext) {
    const user = auth.use('web').user!
    const invitation = await this.find(params.id, organization.id)

    if (!invitation) {
      session.flash('error', 'That invitation no longer exists.')
      return response.redirect().toRoute('members.index')
    }

    await bouncer.with('InvitationPolicy').authorize('resend', invitation)

    try {
      const reissued = await invitations.invite({
        organization,
        invitedBy: user,
        email: invitation.email,
      })

      await mailer.send(
        new TeamInvitationNotification(reissued.invitation, organization, user, reissued.token)
      )
      session.flash('success', `A new invitation has been sent to ${invitation.email}.`)
    } catch (error) {
      if (error instanceof InvitationError) {
        session.flash('error', error.message)
      } else {
        throw error
      }
    }

    return response.redirect().toRoute('members.index')
  }

  private async find(publicId: string, organizationId: number): Promise<Invitation | null> {
    const parsed = parsePublicId('invitation', publicId)

    if (!parsed) {
      return null
    }

    return Invitation.query()
      .where('public_id', parsed)
      .where('organization_id', organizationId)
      .first()
  }
}
