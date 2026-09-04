import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import Invitation from '#models/invitation'
import mailer from '#mail/mailer_service'
import memberships, { MembershipError } from '#organizations/membership_service'
import invitations, { InvitationError } from '#organizations/invitation_service'
import TeamInvitationNotification from '#mail/mails/team_invitation_notification'
import { seatUsage } from '#organizations/seats'
import { parsePublicId } from '#models/public_id'
import { inviteMemberValidator } from '#validators/organization'

/**
 * The Team screen: who is in the workspace, who has been invited, and the
 * owner-only actions on both.
 */
export default class MemberController {
  async index({ view, auth, organization, bouncer }: HttpContext) {
    const user = auth.use('web').user!
    await bouncer.with('MemberPolicy').authorize('viewAny', organization)

    const [members, pending, usage] = await Promise.all([
      memberships.members(organization),
      Invitation.query()
        .where('organization_id', organization.id)
        .whereNull('accepted_at')
        .whereNull('revoked_at')
        .preload('invitedBy')
        .orderBy('created_at', 'desc'),
      seatUsage(organization),
    ])

    return view.render('pages/members/index', {
      members,
      /**
       * Expiry is computed rather than stored, so an invitation that lapsed
       * without a job running still shows as expired (M3 adds the job that
       * tidies them away).
       */
      pendingInvitations: pending.filter((invitation) => invitation.isPending),
      expiredInvitations: pending.filter((invitation) => invitation.isExpired),
      usage,
      currentUser: user,
    })
  }

  async invite({ request, response, session, auth, organization, bouncer }: HttpContext) {
    const user = auth.use('web').user!
    await bouncer.with('MemberPolicy').authorize('invite', organization)

    const { email } = await request.validateUsing(inviteMemberValidator)

    try {
      const { invitation, token } = await invitations.invite({
        organization,
        invitedBy: user,
        email,
      })

      await mailer.send(new TeamInvitationNotification(invitation, organization, user, token))
      session.flash('success', `Invitation sent to ${email}.`)
    } catch (error) {
      if (error instanceof InvitationError) {
        session.flash('error', error.message)
      } else {
        throw error
      }
    }

    return response.redirect().toRoute('members.index')
  }

  async remove({ params, response, session, organization, bouncer }: HttpContext) {
    const member = await this.findMember(params.id, organization.id)

    if (!member) {
      session.flash('error', 'That person is not a member of this workspace.')
      return response.redirect().toRoute('members.index')
    }

    await bouncer.with('MemberPolicy').authorize('remove', member, organization)

    try {
      await memberships.remove(organization, member)
      session.flash('success', `${member.displayName} no longer has access.`)
    } catch (error) {
      if (error instanceof MembershipError) {
        session.flash('error', error.message)
      } else {
        throw error
      }
    }

    return response.redirect().toRoute('members.index')
  }

  /**
   * Leaving is the member-safe half of the mockup's "delete account"
   * (plan §13.6.3).
   */
  async leave({ response, session, auth, organization, bouncer }: HttpContext) {
    const user = auth.use('web').user!
    await bouncer.with('MemberPolicy').authorize('leave', organization)

    try {
      await memberships.leave(organization, user)
    } catch (error) {
      if (error instanceof MembershipError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('settings.organization')
      }
      throw error
    }

    await auth.use('web').logout()
    session.flash('success', `You have left ${organization.name}.`)
    return response.redirect().toRoute('auth.session.create')
  }

  /**
   * A member id from another workspace must miss, not 403 with a hint that
   * the id exists — so tenancy is part of the lookup, not a check after it.
   */
  private async findMember(publicId: string, organizationId: number): Promise<User | null> {
    const parsed = parsePublicId('user', publicId)

    if (!parsed) {
      return null
    }

    return User.query()
      .where('public_id', parsed)
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
      .first()
  }
}
