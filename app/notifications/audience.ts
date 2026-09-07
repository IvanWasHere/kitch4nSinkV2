import type Notification from '#models/notification'

/**
 * Who an announcement reaches (plan §20.3).
 *
 * **This is the only place in the application where a decision is made
 * without an `organization_id` filter.** Every other table is tenant-owned
 * and §5.4's rule holds; here, crossing tenants *is* the feature — one row
 * reaches every workspace on the Pro plan. Which means a bug in this function
 * shows one customer another customer's announcement, and there is nothing
 * else downstream that would catch it.
 *
 * So it is deliberately one small pure function rather than a query, a scope
 * and a template condition that could drift apart:
 *
 * - **Pure.** No database, no network. Everything it needs — the role, the id
 *   and the plan — is already on the context by the time any screen renders,
 *   the same way `PlanService.can()` works.
 * - **Exhaustive.** The switch covers every `audience_type`, and the type is
 *   a closed union from `schema_rules`, so adding a fifth kind of audience
 *   without handling it is a compile error.
 * - **Closed by default.** Anything unrecognised returns false. An
 *   announcement that reaches nobody is a support ticket; one that reaches
 *   everybody is an incident.
 */

/**
 * The parts of a viewer that matter. A structural type rather than the models
 * themselves, so the predicate can be tested against plain objects — which is
 * what makes covering every combination cheap enough to actually do.
 */
export interface AudienceViewer {
  id: number
  role: 'owner' | 'member'
  planKey: string
}

export function appliesTo(
  notification: Pick<Notification, 'audienceType' | 'audience'>,
  viewer: AudienceViewer
): boolean {
  const audience = notification.audience ?? {}

  switch (notification.audienceType) {
    case 'all':
      return true

    /**
     * Everybody in an organisation on one of these plans, owners and members
     * alike. An empty list matches nobody rather than everybody — see the
     * note on being closed by default.
     */
    case 'plan':
      return (audience.planKeys ?? []).includes(viewer.planKey)

    /**
     * Owners only, optionally narrowed by plan. The plan list being empty
     * here means "owners on any plan", because the *type* has already
     * narrowed the audience — unlike `plan`, where an empty list would mean
     * the author picked nothing.
     */
    case 'owners': {
      if (viewer.role !== 'owner') {
        return false
      }

      const planKeys = audience.planKeys ?? []
      return planKeys.length === 0 || planKeys.includes(viewer.planKey)
    }

    /**
     * Named people. Internal ids, never public ones: they do not leave the
     * process, and the admin screen resolves people through the existing user
     * search.
     */
    case 'users':
      return (audience.userIds ?? []).includes(viewer.id)

    default:
      return false
  }
}

/**
 * A one-line description of who a notification reaches, for the back-office
 * list. Written as a sentence rather than as the raw enum, because "owners"
 * and "owners on Pro" are different answers to the question somebody is
 * actually asking.
 */
export function describeAudience(
  notification: Pick<Notification, 'audienceType' | 'audience'>
): string {
  const planKeys = notification.audience?.planKeys ?? []
  const userIds = notification.audience?.userIds ?? []

  switch (notification.audienceType) {
    case 'all':
      return 'Everyone'

    case 'plan':
      return planKeys.length ? `Everyone on ${planKeys.join(', ')}` : 'Nobody — no plan chosen'

    case 'owners':
      return planKeys.length ? `Owners on ${planKeys.join(', ')}` : 'All workspace owners'

    case 'users':
      return userIds.length === 1
        ? '1 named person'
        : `${userIds.length} named ${userIds.length === 1 ? 'person' : 'people'}`

    default:
      return 'Nobody'
  }
}
