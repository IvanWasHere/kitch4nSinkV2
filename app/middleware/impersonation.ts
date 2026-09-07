import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import StaffUser from '#models/staff_user'

/**
 * The session key holding an impersonation.
 */
export const IMPERSONATION_SESSION_KEY = 'impersonation'

/**
 * How long an impersonation lasts before it hard-expires (plan §6).
 *
 * A support agent who wanders off must not leave a live session inside a
 * customer's workspace, and "until they sign out" is not a bound anybody
 * enforces. Sixty minutes is long enough to reproduce a bug and short enough
 * that a forgotten tab closes itself.
 */
export const IMPERSONATION_MINUTES = 60

export interface ImpersonationState {
  staffId: number
  userId: number

  /**
   * Absolute expiry, not a sliding one. A sliding window can be kept open
   * for ever by a page that polls.
   */
  expiresAt: string

  /**
   * `support` is read-only, `admin` may write (plan §6). Copied into the
   * session at the start rather than re-read, so demoting a staff member
   * cannot silently widen a session already in flight — and re-checked
   * against the live row below, so *revoking* them closes it.
   */
  staffRole: 'admin' | 'support'
}

/**
 * Enforces the impersonation rules on every tenant request (plan §6).
 *
 * Runs inside the tenant stack, so it sees requests made *as* the customer:
 *
 * 1. **Hard expiry.** Past the window the impersonation ends and the staff
 *    member is returned to the back-office, rather than silently continuing.
 * 2. **The staff row is re-checked.** A disabled or deleted staff account
 *    ends the session immediately, not at the next sign-in.
 * 3. **`support` is read-only.** Every non-GET request is refused. That is
 *    the difference between "look at what the customer sees" and "act as the
 *    customer", and support has the first without the second.
 * 4. The banner. Rendered by the layout from what this shares, on every
 *    screen, so nobody forgets which hat they are wearing.
 */
export default class ImpersonationMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const state = ctx.session.get(IMPERSONATION_SESSION_KEY) as ImpersonationState | undefined

    if (!state) {
      return next()
    }

    if (DateTime.fromISO(state.expiresAt) <= DateTime.utc()) {
      return this.end(ctx, 'That impersonation session expired.')
    }

    /**
     * Loaded fresh every request. The alternative — trusting the session —
     * means revoking a staff member's access does nothing until they choose
     * to sign out.
     */
    const staff = await StaffUser.find(state.staffId)

    if (!staff || staff.isDisabled) {
      return this.end(ctx, 'That staff account can no longer impersonate.')
    }

    ctx.impersonation = state

    if ('view' in ctx) {
      ctx.view.share({
        impersonation: {
          staffEmail: staff.email,
          staffRole: state.staffRole,
          readOnly: state.staffRole !== 'admin',
          expiresAt: state.expiresAt,
        },
      })
    }

    /**
     * Read-only impersonation for `support`.
     *
     * Checked by HTTP method rather than by route, because every route that
     * changes something in this application is a POST — and a rule expressed
     * as a list of routes is a rule somebody forgets to add to.
     *
     * With exactly one exception, and it has to be here: **ending the
     * impersonation is itself a POST**. Without this, support could start a
     * session and then be unable to leave it — the banner's button would
     * bounce off this very check — and the only way out would be waiting an
     * hour for the expiry.
     */
    const isEndingImpersonation = ctx.route?.name === 'impersonation.destroy'

    if (state.staffRole !== 'admin' && !isEndingImpersonation && ctx.request.method() !== 'GET') {
      ctx.session.flash(
        'error',
        'Support impersonation is read-only. Ask an admin if a change really has to be made from inside the workspace.'
      )

      /**
       * Back to where they were, which on a tenant screen is the screen they
       * tried to act on — so the flash explaining why is read in context.
       */
      return ctx.response.redirect().back()
    }

    return next()
  }

  private end(ctx: HttpContext, message: string) {
    ctx.session.forget(IMPERSONATION_SESSION_KEY)

    /**
     * The tenant session goes too. Leaving somebody signed in as the customer
     * after the impersonation ended is exactly the state this is meant to
     * prevent.
     */
    void ctx.auth.use('web').logout()

    ctx.session.flash('error', message)

    return ctx.response.redirect().toRoute('admin.dashboard')
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    /**
     * Present only while a staff member is acting as a tenant user. Its
     * absence is what makes every audit entry outside impersonation
     * unambiguous.
     */
    impersonation?: ImpersonationState
  }
}
