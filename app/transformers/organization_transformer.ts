import { BaseTransformer } from '@adonisjs/core/transformers'

import type Organization from '#models/organization'
import type { PlanUsage } from '#billing/plan_service'

/**
 * `GET /api/v1/organization` — plan, limits and current usage (plan §11).
 *
 * This endpoint exists for one job: letting an integration **check headroom
 * before a bulk import** rather than discovering the ceiling as a 402 in the
 * middle of one. So it reports `limit`, `used` and `remaining` for every
 * count, using the same `PlanService` numbers enforcement uses — a headroom
 * figure that disagreed with the block would be worse than none.
 *
 * `null` means unlimited, exactly as it does in `config/plans.ts`.
 */
export default class OrganizationTransformer extends BaseTransformer<Organization> {
  constructor(
    organization: Organization,
    private usage: PlanUsage
  ) {
    super(organization)
  }

  toObject() {
    return {
      id: this.resource.publicId,
      name: this.resource.name,
      timezone: this.resource.timezone,

      plan: {
        key: this.usage.planKey,
        name: this.usage.plan.name,
        features: [...this.usage.plan.features],
      },

      /**
       * Shaped as `{ limit, used, remaining }` per quota rather than a flat
       * map, because "how many more can I create" is the question being
       * asked and making a client subtract two numbers invites off-by-ones.
       */
      usage: {
        lists: this.describe(this.usage.lists),
        seats: this.describe(this.usage.seats),
        storage_mb: this.describe(this.usage.storage),
        todos_per_list: {
          limit: this.usage.plan.limits.todosPerList,
          used: null,
          remaining: null,
        },
      },
    }
  }

  private describe(usage: { current: number; limit: number | null; remaining: number | null }) {
    return { limit: usage.limit, used: usage.current, remaining: usage.remaining }
  }
}
