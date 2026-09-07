import type { HttpContext } from '@adonisjs/core/http'

import Organization from '#models/organization'
import audit from '#audit/audit_service'

/**
 * The audit log screen (plan §12).
 *
 * Filterable because the questions support asks are compound — "what did
 * this staff member do to this customer" — and a flat reverse-chronological
 * list answers none of them once there is a month of history.
 */
export default class AdminAuditLogController {
  async index({ view, request, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const organizationPublicId = String(request.input('organization', ''))
    const actorType = String(request.input('actor_type', ''))
    const action = String(request.input('action', ''))

    const organization = organizationPublicId
      ? await Organization.query().where('public_id', organizationPublicId).first()
      : null

    const [entries, actions] = await Promise.all([
      audit.search({
        organizationId: organization?.id ?? null,
        actorType: (actorType || null) as never,
        action: action || null,
        limit: 200,
      }),
      audit.recordedActions(),
    ])

    /**
     * The organisations behind the entries, resolved in one query rather than
     * one per row — the list is long by design.
     */
    const organizationIds = [
      ...new Set(entries.map((entry) => entry.organizationId).filter(Boolean)),
    ] as number[]

    const organizations = organizationIds.length
      ? await Organization.query().whereIn('id', organizationIds)
      : []

    return view.render('pages/admin/audit_logs/index', {
      entries,
      actions,
      organizations: new Map(organizations.map((one) => [one.id, one])),
      filters: { organization: organizationPublicId, actorType, action },
      actorTypes: ['user', 'staff', 'api_key', 'system'],
    })
  }
}
