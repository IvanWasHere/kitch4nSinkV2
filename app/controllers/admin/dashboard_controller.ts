import type { HttpContext } from '@adonisjs/core/http'

import metrics, { REVENUE_RANGES } from '#admin/metrics_service'
import type { RevenueRange } from '#admin/metrics_service'
import audit from '#audit/audit_service'

/**
 * The back-office dashboard (plan §12).
 *
 * Ordered by what somebody opening it needs: **what is broken** first
 * (failed jobs, unapplied webhooks, workspaces in trouble), then what the
 * business is worth, then how it moved. A dashboard that leads with MRR is a
 * dashboard nobody opens during an incident.
 */
export default class AdminDashboardController {
  async index({ request, view, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    /**
     * The window is a query string rather than client state, so a range can
     * be linked to and pasted into a ticket — and so the screen still works
     * with the bundle blocked (plan §13.3). Anything unrecognised falls back
     * to 30 days instead of erroring: this is a dashboard, not a form.
     */
    const requested = String(request.input('range', '30d'))
    const range = (requested in REVENUE_RANGES ? requested : '30d') as RevenueRange

    const [figures, revenue, growth, attention, signups, trail] = await Promise.all([
      metrics.collect(),
      metrics.revenue(range),
      metrics.growth(),
      metrics.needsAttention(),
      metrics.recentSignups(),
      audit.search({ limit: 10 }),
    ])

    return view.render('pages/admin/dashboard', {
      metrics: figures,
      revenue,
      growth,
      attention,
      signups,
      trail,
      ranges: Object.keys(REVENUE_RANGES),
    })
  }
}
