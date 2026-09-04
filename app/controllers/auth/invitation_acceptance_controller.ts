import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import mailer from '#mail/mailer_service'
import invitations, { InvitationError } from '#organizations/invitation_service'
import InvitationAcceptedNotification from '#mail/mails/invitation_accepted_notification'
import { acceptInvitationValidator } from '#validators/organization'

/**
 * Accepting an invitation.
 *
 * Public and tokenised: the recipient has no account yet, and even when they
 * do they are almost certainly not signed in on the device where they opened
 * the email.
 */
export default class InvitationAcceptanceController {
  async show({ params, view, response, session }: HttpContext) {
    const invitation = await invitations.findByToken(params.token)

    if (!invitation || !invitation.isPending) {
      return view.render('pages/auth/invitation_invalid', {
        reason: this.explain(invitation),
      })
    }

    /**
     * The address may already have an account — from a previous workspace, or
     * from signing up before the invitation arrived. Saying so up front is
     * better than a confusing "email already taken" after the form is filled
     * in (plan §5.4).
     */
    const existing = await User.query()
      .where('email', invitation.email)
      .whereNull('deleted_at')
      .first()

    if (existing) {
      return view.render('pages/auth/invitation_invalid', {
        reason:
          'That address already belongs to another workspace. Leave it first, or ask for an invitation to a different address.',
      })
    }

    session.flash('notice', `You have been invited to ${invitation.organization.name}.`)
    return response.redirect().toRoute('invitations.form', { token: params.token })
  }

  async form({ params, view }: HttpContext) {
    const invitation = await invitations.findByToken(params.token)

    if (!invitation || !invitation.isPending) {
      return view.render('pages/auth/invitation_invalid', { reason: this.explain(invitation) })
    }

    return view.render('pages/auth/accept_invitation', {
      invitation,
      organization: invitation.organization,
      token: params.token,
    })
  }

  async accept({ params, request, response, session, auth }: HttpContext) {
    const invitation = await invitations.findByToken(params.token)

    if (!invitation || !invitation.isPending) {
      return response.redirect().toRoute('invitations.show', { token: params.token })
    }

    const { fullName, password } = await request.validateUsing(acceptInvitationValidator)

    let user: User
    try {
      user = await invitations.accept({ token: params.token, fullName, password })
    } catch (error) {
      if (error instanceof InvitationError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('invitations.form', { token: params.token })
      }
      throw error
    }

    const organization = invitation.organization
    const owner = organization.ownerId ? await User.find(organization.ownerId) : null

    if (owner) {
      await mailer.send(new InvitationAcceptedNotification(owner, user, organization))
    }

    await auth.use('web').login(user)
    await user.recordLogin()

    session.flash('success', `Welcome to ${organization.name}.`)
    return response.redirect().toRoute('dashboard.index')
  }

  private explain(invitation: { status: string } | null): string {
    if (!invitation) {
      return 'That invitation link is not valid.'
    }

    switch (invitation.status) {
      case 'accepted':
        return 'That invitation has already been accepted. Try signing in instead.'
      case 'revoked':
        return 'That invitation was withdrawn. Ask the workspace owner for a new one.'
      case 'expired':
        return 'That invitation has expired. Ask the workspace owner to send a new one.'
      default:
        return 'That invitation link is not valid.'
    }
  }
}
