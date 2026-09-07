import { Bouncer } from '@adonisjs/bouncer'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import type StaffUser from '#models/staff_user'
import { staffPolicies } from '#admin/staff_policies'

/**
 * Authenticates the staff guard (D5).
 *
 * A separate middleware rather than `auth({ guards: ['staff'] })` so the
 * unauthenticated redirect goes to /admin/login, and so a disabled account is
 * rejected on every request rather than only at sign-in — revoking access
 * should take effect immediately, not at the end of a session.
 */
export default class StaffAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    try {
      await ctx.auth.use('staff').authenticate()
    } catch {
      return ctx.response.redirect().toRoute('admin.session.create')
    }

    const staff = ctx.auth.use('staff').user!

    if (staff.isDisabled) {
      await ctx.auth.use('staff').logout()
      ctx.session.flash('error', 'That account has been disabled.')
      return ctx.response.redirect().toRoute('admin.session.create')
    }

    /**
     * A Bouncer of its own, over the staff registry (plan §6, D5).
     *
     * Not `ctx.bouncer`: that one is typed against the tenant `User`, and a
     * staff policy taking a `StaffUser` cannot be registered on it without
     * one of the two silently dropping out of the type-level action list.
     * Two guards, two tables, two registries.
     */
    ctx.staffBouncer = new Bouncer(
      (): StaffUser | null => ctx.auth.use('staff').user ?? null,
      {},
      staffPolicies
    ).setContainerResolver(ctx.containerResolver)

    if ('view' in ctx) {
      ctx.view.share({ staff, ...ctx.staffBouncer.edgeHelpers })
    }

    return next()
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    /**
     * Present only on back-office routes. Its absence on a tenant request is
     * what stops a staff-level check from being written where it would
     * silently pass.
     */
    staffBouncer: Bouncer<StaffUser, Record<never, never>, typeof staffPolicies>
  }
}
