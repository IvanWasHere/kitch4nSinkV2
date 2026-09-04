import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Restricts a route group to the organisation's owner.
 *
 * Policies remain the authority on individual actions (D7); this is the
 * coarse gate on whole areas — billing and API keys — so a member never
 * reaches a screen only to be refused on every button.
 */
export default class RequireOwnerMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.use('web').user!

    if (!user.isOwner) {
      ctx.session.flash('error', 'Only the workspace owner can do that.')
      return ctx.response.redirect().toRoute('dashboard.index')
    }

    return next()
  }
}
