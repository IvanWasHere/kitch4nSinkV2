import type { HttpContext } from '@adonisjs/core/http'

import dashboard from '#dashboard/widgets'

/**
 * The Overview screen (plan §13.5).
 *
 * It knows nothing about what it is showing. The figures, the tables and the
 * feeds are widgets registered in `start/dashboard.ts`; the usage meters come
 * from the quota registry and are already on the shared state. So this is the
 * whole controller, and it stays that way however many features the
 * application grows.
 */
export default class DashboardController {
  async index({ view, organization }: HttpContext) {
    return view.render('pages/dashboard/index', {
      widgets: await dashboard.load(organization),
    })
  }
}
