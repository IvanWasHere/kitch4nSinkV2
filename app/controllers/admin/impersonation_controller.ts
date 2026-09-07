import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import StaffUser from '#models/staff_user'
import Organization from '#models/organization'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import {
  IMPERSONATION_MINUTES,
  IMPERSONATION_SESSION_KEY,
  type ImpersonationState,
} from '#middleware/impersonation'

/**
 * Starting and ending an impersonation (plan §6, §12).
 *
 * The point is to see what a customer sees when they say "the button does
 * nothing" — and the whole design is about making that impossible to abuse
 * or to forget: time-boxed, banner on every screen, read-only for support,
 * both ids in every audit entry.
 */
export default class AdminImpersonationController {
  async store(ctx: HttpContext) {
    const { params, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('impersonate')

    const staff = auth.use('staff').user!
    const user = await User.query().where('public_id', params.id).whereNull('deleted_at').first()

    if (!user) {
      session.flash('error', 'No such user.')
      return response.redirect().toRoute('admin.users.index')
    }

    const organization = await Organization.query()
      .where('id', user.organizationId)
      .whereNull('deleted_at')
      .first()

    if (!organization) {
      session.flash('error', 'That user has no workspace to impersonate them in.')
      return response.redirect().toRoute('admin.users.index')
    }

    /**
     * A suspended workspace signs everybody out on every request, including
     * an impersonator — so refuse up front rather than producing a session
     * that dies on its first page load.
     */
    if (organization.isSuspended) {
      session.flash(
        'error',
        'That workspace is suspended. Restore it first if you need to look inside.'
      )
      return response.redirect().back()
    }

    const state: ImpersonationState = {
      staffId: staff.id,
      userId: user.id,
      expiresAt: DateTime.utc().plus({ minutes: IMPERSONATION_MINUTES }).toISO()!,
      /**
       * Captured at the start. `ImpersonationMiddleware` still re-reads the
       * staff row every request, so revoking access ends the session — but
       * the *role* is fixed here so a promotion mid-session cannot widen a
       * read-only impersonation into a writable one without starting again.
       */
      staffRole: staff.role,
    }

    session.put(IMPERSONATION_SESSION_KEY, state)

    /**
     * Signed in as the customer on the **web** guard, which is what makes
     * every tenant screen behave exactly as it does for them. The staff
     * session is untouched and independent, so ending the impersonation
     * returns to the back-office rather than to a login page.
     */
    await auth.use('web').login(user)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.impersonationStarted,
      organization,
      subjectType: 'User',
      subjectId: user.publicId,
      metadata: {
        email: user.email,
        readOnly: staff.role !== 'admin',
        expiresAt: state.expiresAt,
      },
    })

    session.flash(
      'notice',
      `You are now looking at ${organization.name} as ${user.email}. This ends in ${IMPERSONATION_MINUTES} minutes.`
    )

    return response.redirect().toRoute('dashboard.index')
  }

  /**
   * Stop, and go back to being staff.
   *
   * Reachable from the banner on every tenant screen, because the way an
   * impersonation gets forgotten is having to remember a URL to end it.
   */
  async destroy(ctx: HttpContext) {
    const { session, response, auth } = ctx

    const state = session.get(IMPERSONATION_SESSION_KEY) as ImpersonationState | undefined

    if (state) {
      const [user, staff] = await Promise.all([
        User.find(state.userId),
        StaffUser.find(state.staffId),
      ])

      /**
       * Attributed from the **session**, not from the staff guard.
       *
       * This route is reached from a tenant screen and therefore has no
       * staff middleware, so `auth.use('staff').user` is undefined here —
       * relying on it produced an "ended by nobody" entry, which is worse
       * than no entry at all because it looks like a record.
       */
      await audit.recordStaffAction(ctx, {
        action: AUDIT_ACTIONS.impersonationEnded,
        organization: user ? { id: user.organizationId } : null,
        subjectType: 'User',
        subjectId: user?.publicId ?? String(state.userId),
        actorId: state.staffId,
        metadata: { staffEmail: staff?.email },
      })
    }

    session.forget(IMPERSONATION_SESSION_KEY)
    await auth.use('web').logout()

    session.flash('success', 'Impersonation ended.')
    return response.redirect().toRoute('admin.dashboard')
  }
}
