import type { HttpContext } from '@adonisjs/core/http'

/**
 * The signed-in landing page.
 *
 * A placeholder until M3.5 fills it with the real overview (lists, open
 * todos, completed this week, overdue). It exists now because sign-in has to
 * land somewhere, and because the sidebar's first item should not be missing
 * for three milestones.
 */
export default class DashboardController {
  async index({ view }: HttpContext) {
    return view.render('pages/dashboard/index')
  }
}
