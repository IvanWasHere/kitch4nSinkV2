import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Keeps a signed-in staff member away from /admin/login.
 */
export default class StaffGuestMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (await ctx.auth.use('staff').check()) {
      return ctx.response.redirect().toRoute('admin.dashboard')
    }

    return next()
  }
}
