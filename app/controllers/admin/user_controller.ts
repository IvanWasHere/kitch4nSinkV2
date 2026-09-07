import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import search from '#admin/search_service'
import mailer from '#mail/mailer_service'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import tokens from '#auth/auth_token_service'
import twoFactor from '#auth/two_factor_service'
import VerifyEmailNotification from '#mail/mails/verify_email_notification'

/**
 * Users in the back-office (plan §12).
 *
 * Three things support actually needs to do, all of them reversible and all
 * of them the reason somebody opened a ticket: resend a verification email,
 * confirm an address by hand when mail is not arriving, and clear a lost
 * second factor.
 */
export default class AdminUserController {
  async index({ view, request, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const term = String(request.input('q', ''))

    return view.render('pages/admin/users/index', {
      term,
      users: await search.users(term),
    })
  }

  /**
   * Send the verification email again.
   *
   * The commonest ticket there is, and the safest fix: it grants nothing on
   * its own, since the link still has to be opened from the customer's inbox.
   */
  async resendVerification(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('assistUser')

    const user = await this.findOrFail(params.id)

    if (user.hasVerifiedEmail) {
      session.flash('error', 'That address is already verified.')
      return response.redirect().back()
    }

    const token = await tokens.issue(user, 'verify_email')
    await mailer.send(new VerifyEmailNotification(user, token))

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.userVerificationResent,
      organization: { id: user.organizationId },
      subjectType: 'User',
      subjectId: user.publicId,
    })

    session.flash('success', `Verification email queued for ${user.email}.`)
    return response.redirect().back()
  }

  /**
   * Mark an address verified without the email.
   *
   * The escape hatch for a customer whose provider is silently dropping our
   * mail — which does happen, and leaves them unable to use an account they
   * have paid for. Audited precisely because it bypasses the check it
   * replaces.
   */
  async verify(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('assistUser')

    const user = await this.findOrFail(params.id)

    if (user.hasVerifiedEmail) {
      session.flash('error', 'That address is already verified.')
      return response.redirect().back()
    }

    user.emailVerifiedAt = DateTime.utc()
    await user.save()

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.userVerified,
      organization: { id: user.organizationId },
      subjectType: 'User',
      subjectId: user.publicId,
      metadata: { email: user.email },
    })

    session.flash('success', `${user.email} is verified.`)
    return response.redirect().back()
  }

  /**
   * Clear a lost second factor.
   *
   * Not "reset it to something we choose" — it is removed, and the customer
   * enrols again from their own security screen. Staff never hold a
   * credential that would let them sign in as somebody; impersonation is the
   * sanctioned, audited way to see what a customer sees.
   */
  async resetTwoFactor(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('assistUser')

    const user = await this.findOrFail(params.id)

    if (!user.hasTwoFactor) {
      session.flash('error', 'That account does not have two-factor enabled.')
      return response.redirect().back()
    }

    await twoFactor.disable(user)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.userTwoFactorReset,
      organization: { id: user.organizationId },
      subjectType: 'User',
      subjectId: user.publicId,
      metadata: { email: user.email },
    })

    session.flash(
      'success',
      `Two-factor cleared for ${user.email}. They will be asked to set it up again.`
    )

    return response.redirect().back()
  }

  private async findOrFail(publicId: string): Promise<User> {
    return User.query().where('public_id', publicId).firstOrFail()
  }
}
