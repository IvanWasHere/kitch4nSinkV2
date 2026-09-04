import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

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

    if ('view' in ctx) {
      ctx.view.share({ staff })
    }

    return next()
  }
}
