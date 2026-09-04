import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Keeps unverified users out of the application proper.
 *
 * Applied to the tenant application routes, never to the verification screens
 * themselves — a middleware that redirects the page it is protecting to
 * itself is an infinite loop.
 */
export default class EnsureVerifiedEmailMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.use('web').user

    if (user && !user.hasVerifiedEmail) {
      return ctx.response.redirect().toRoute('auth.verify_email.notice')
    }

    return next()
  }
}
