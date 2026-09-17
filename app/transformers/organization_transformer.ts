import string from '@adonisjs/core/helpers/string'
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
       *
       * Built from the quota registry rather than written out, so a quota
       * that arrives with a feature is reported without an edit here and one
       * that leaves with it stops being reported. Keys are snake_cased to
       * match the rest of the API — `storageMb` becomes `storage_mb`.
       *
       * A limit with no workspace total reports `used: null` rather than
       * being left out: `todos_per_list` is a real ceiling an integration
       * needs to know about before it starts writing, it just has no single
       * number to compare against.
       */
      usage: Object.fromEntries([
        ...this.usage.meters.map((quota) => [
          string.snakeCase(quota.key),
          { limit: quota.limit, used: quota.current, remaining: quota.remaining },
        ]),
        ...this.usage.declared.map((quota) => [
          string.snakeCase(quota.key),
          { limit: quota.limit, used: null, remaining: null },
        ]),
      ]),
    }
  }
}
