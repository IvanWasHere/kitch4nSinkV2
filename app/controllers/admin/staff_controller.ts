import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

import StaffUser from '#models/staff_user'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import { createStaffValidator } from '#validators/admin'

/**
 * Staff management (plan §12) — admin only.
 *
 * The reason it is admin-only is circular and deliberate: anybody who can
 * create a staff account can grant themselves everything else on these
 * screens.
 */
export default class AdminStaffController {
  async index({ view, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('manageStaff')

    return view.render('pages/admin/staff/index', {
      members: await StaffUser.query().orderBy('id', 'asc'),
    })
  }

  /**
   * Create an account. The password is set here and the new member enrols
   * their own second factor on first sign-in — two-factor is mandatory for
   * staff, and the guard sends them to set it up before any admin route runs.
   */
  async store(ctx: HttpContext) {
    const { request, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('manageStaff')

    const payload = await request.validateUsing(createStaffValidator)
    const email = payload.email.trim().toLowerCase()

    if (await StaffUser.findBy('email', email)) {
      session.flash('error', 'A staff account already exists for that address.')
      return response.redirect().back()
    }

    const staff = await StaffUser.create({
      email,
      fullName: payload.fullName,
      password: payload.password,
      role: payload.role,
    })

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.staffCreated,
      subjectType: 'StaffUser',
      subjectId: staff.publicId,
      metadata: { email: staff.email, role: staff.role },
    })

    session.flash(
      'success',
      `${staff.email} can sign in and will be asked to set up two-factor immediately.`
    )

    return response.redirect().toRoute('admin.staff.index')
  }

  /**
   * Disable or re-enable an account.
   *
   * Disabled rather than deleted: `audit_logs.actor_id` points at these rows,
   * and deleting one would orphan the record of what that person did. The
   * guard re-checks `disabled_at` on every request, so this takes effect
   * immediately rather than at the end of their session.
   */
  async toggle(ctx: HttpContext) {
    const { params, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('manageStaff')

    const staff = await StaffUser.query().where('public_id', params.id).firstOrFail()
    const actor = auth.use('staff').user!

    /**
     * You cannot disable yourself, and that single rule is what keeps the
     * back-office reachable.
     *
     * Reaching this action at all requires being an active admin, so any
     * other admin being disabled leaves at least the one doing it. A
     * separate "cannot disable the last admin" check would therefore never
     * fire — it would be code that looks like a safeguard and tests as one
     * without ever running.
     */
    if (staff.id === actor.id) {
      session.flash('error', 'You cannot disable your own account.')
      return response.redirect().back()
    }

    const disabling = !staff.isDisabled

    staff.disabledAt = disabling ? DateTime.utc() : null
    await staff.save()

    await audit.recordStaffAction(ctx, {
      action: disabling ? AUDIT_ACTIONS.staffDisabled : AUDIT_ACTIONS.staffEnabled,
      subjectType: 'StaffUser',
      subjectId: staff.publicId,
      metadata: { email: staff.email },
    })

    session.flash(
      'success',
      disabling ? `${staff.email} is disabled, effective now.` : `${staff.email} can sign in again.`
    )

    return response.redirect().toRoute('admin.staff.index')
  }
}
