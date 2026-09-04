import type { HttpContext } from '@adonisjs/core/http'

import dashboard from '#todos/dashboard_service'

/**
 * The Overview screen (plan §13.5): four stat cards, recent todos, and what
 * has been finished lately.
 */
export default class DashboardController {
  async index({ view, organization }: HttpContext) {
    const [stats, recent, activity] = await Promise.all([
      dashboard.statsFor(organization),
      dashboard.recentTodos(organization),
      dashboard.recentActivity(organization),
    ])

    return view.render('pages/dashboard/index', { stats, recent, activity })
  }
}
