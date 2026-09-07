import type { HttpContext } from '@adonisjs/core/http'

import metrics from '#admin/metrics_service'
import audit from '#audit/audit_service'

/**
 * The back-office dashboard (plan §12).
 *
 * Ordered by what somebody opening it needs: **what is broken** first
 * (failed jobs, unapplied webhooks, workspaces in trouble), then the
 * business numbers. A dashboard that leads with MRR is a dashboard nobody
 * opens during an incident.
 */
export default class AdminDashboardController {
  async index({ view, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const [figures, attention, signups, trail] = await Promise.all([
      metrics.collect(),
      metrics.needsAttention(),
      metrics.recentSignups(),
      audit.search({ limit: 10 }),
    ])

    return view.render('pages/admin/dashboard', {
      metrics: figures,
      attention,
      signups,
      trail,
    })
  }
}
