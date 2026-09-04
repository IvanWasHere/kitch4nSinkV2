import type { HttpContext } from '@adonisjs/core/http'

/**
 * The back-office landing page. M7 builds the real thing (MRR, signups,
 * churn, failed jobs, failed webhooks); this exists so the staff guard and
 * the admin layout have somewhere to land in M1.
 */
export default class AdminDashboardController {
  async index({ view }: HttpContext) {
    return view.render('pages/admin/dashboard')
  }
}
