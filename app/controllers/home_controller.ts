import type { HttpContext } from '@adonisjs/core/http'

/**
 * `/` when no feature provides a front page (plan §22.7).
 *
 * The Landing module replaces this route with its marketing page. Without it,
 * the root is simply the way in: the workspace for somebody signed in, the
 * sign-in page for everybody else. The route keeps the name `home` either way,
 * because every layout and error page links to it by that name.
 */
export default class HomeController {
  async index({ auth, response }: HttpContext) {
    if (auth.use('web').isAuthenticated) {
      return response.redirect().withQs(false).toRoute('dashboard.index')
    }

    return response.redirect().withQs(false).toRoute('auth.session.create')
  }
}
