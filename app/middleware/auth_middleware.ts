import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  /**
   * The URL to redirect to, when authentication fails
   */
  redirectTo = '/login'

  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })

    /**
     * A session outlives the row behind it. Someone removed from a workspace
     * while signed in must lose access on their next request rather than at
     * the end of their session, so the soft delete is re-checked here as well
     * as in the auth finder.
     */
    const user = ctx.auth.use('web').user
    if (user?.isDeleted) {
      await ctx.auth.use('web').logout()
      ctx.session.flash('error', 'Your access to that workspace has been removed.')
      return ctx.response.redirect().toRoute('auth.session.create')
    }

    return next()
  }
}
