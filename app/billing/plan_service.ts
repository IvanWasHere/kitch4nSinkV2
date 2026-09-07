import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import TodoList from '#models/todo_list'
import Organization from '#models/organization'
import { seatUsage } from '#organizations/seats'
import UpgradeRequiredException from '#exceptions/upgrade_required_exception'
import PlanLimitExceededException from '#exceptions/plan_limit_exceeded_exception'
import {
  DEFAULT_PLAN,
  limitFor,
  planFor,
  plans,
  type FeatureKey,
  type LimitKey,
  type PlanDefinition,
  type PlanKey,
} from '#config/plans'

/**
 * One limit, as both enforcement and the UI see it.
 */
export interface LimitUsage {
  current: number
  limit: number | null
  remaining: number | null

  /**
   * At or over the ceiling. `>=` rather than `>` because an organisation that
   * has landed exactly on its limit cannot create the next one — and because
   * a downgrade can put usage *above* the ceiling, which is allowed to happen
   * and must still read as full.
   */
  isFull: boolean

  /**
   * The meter turns amber here (plan §7.4). Unlimited never does.
   */
  isNearLimit: boolean
}

export interface PlanUsage {
  planKey: PlanKey
  plan: PlanDefinition
  lists: LimitUsage
  seats: LimitUsage
}

/**
 * Entitlements, usage and enforcement — the single source for all three
 * (plan §7.3, §7.4).
 *
 * The point of one class is that the meter on the dashboard, the disabled
 * *Add list* button, the `402` and the row-locked check inside the create
 * transaction all read the same numbers. Two calculations of "how many lists
 * are you using" will eventually disagree, and the day they do a customer is
 * either blocked below their limit or billed for a plan they are exceeding.
 *
 * Gating is a pure function over `organization.planKey`: no network call, no
 * database read, so `can()` is free to call in a template.
 */
export class PlanService {
  /**
   * The plan an organisation is on. Falls back to Free for a key that is no
   * longer in config — a plan we retired must not lock a customer out of
   * their own data.
   */
  planFor(organization: Pick<Organization, 'planKey'>): PlanDefinition {
    return planFor(organization.planKey)
  }

  planKeyFor(organization: Pick<Organization, 'planKey'>): PlanKey {
    return organization.planKey in plans ? (organization.planKey as PlanKey) : DEFAULT_PLAN
  }

  /**
   * Whether the plan includes a feature.
   */
  can(organization: Pick<Organization, 'planKey'>, feature: FeatureKey | string): boolean {
    return (this.planFor(organization).features as readonly string[]).includes(feature)
  }

  assertCan(organization: Pick<Organization, 'planKey'>, feature: FeatureKey | string): void {
    if (!this.can(organization, feature)) {
      throw new UpgradeRequiredException(feature)
    }
  }

  /**
   * A limit, with any staff override merged over the plan (plan §7.4).
   * `null` is unlimited; `0` means the plan does not have the feature at all.
   */
  limit(
    organization: Pick<Organization, 'planKey' | 'limitOverrides'>,
    limit: LimitKey
  ): number | null {
    return limitFor(organization, limit)
  }

  /**
   * Would `desired` fit? The one comparison the whole quota system rests on.
   */
  isWithinLimit(
    organization: Pick<Organization, 'planKey' | 'limitOverrides'>,
    limit: LimitKey,
    desired: number
  ): boolean {
    const allowed = this.limit(organization, limit)
    return allowed === null || desired <= allowed
  }

  /**
   * Refuse a create that would take the organisation past a limit.
   *
   * `desired` is the count **after** the create, so callers pass
   * `current + 1` — being explicit about that is what stops the classic
   * off-by-one where a 3-list plan silently allows a fourth.
   */
  assertWithinLimit(
    organization: Pick<Organization, 'planKey' | 'limitOverrides'>,
    limit: LimitKey,
    desired: number
  ): void {
    if (this.isWithinLimit(organization, limit, desired)) {
      return
    }

    throw new PlanLimitExceededException({
      limit,
      allowed: this.limit(organization, limit) ?? 0,
      current: desired - 1,
    })
  }

  /**
   * Count under a lock, then decide.
   *
   * A plain `count() → compare → insert` is a race: two requests both read 2
   * against a 3-list plan and both insert, and the customer has four lists on
   * a plan that sells three (plan §5.5). Locking the *organisation* row first
   * serialises every create for that tenant, so the second request reads the
   * first one's write.
   *
   * `forUpdate()` is a real row lock on Postgres. On SQLite it is a no-op and
   * does not need to be anything else: better-sqlite3 is synchronous and
   * serialises writes at the connection, so the interleaving this guards
   * against cannot occur there. That is the whole of the dialect difference,
   * and it needs no branch in application code.
   */
  async lockAndAssertLimit(
    trx: TransactionClientContract,
    organization: Organization,
    limit: LimitKey,
    count: (trx: TransactionClientContract) => Promise<number>
  ): Promise<number> {
    const locked = await Organization.query({ client: trx })
      .forUpdate()
      .where('id', organization.id)
      .firstOrFail()

    const current = await count(trx)

    this.assertWithinLimit(locked, limit, current + 1)

    return current
  }

  /**
   * How many lists count against the quota.
   *
   * Archived lists are included on purpose: archiving is a UI convenience,
   * not a quota escape (plan §5.6). Soft-deleted ones are not — deleting is
   * how a customer frees a slot.
   */
  async listCount(organization: Organization, trx?: TransactionClientContract): Promise<number> {
    const [row] = await TodoList.query(trx ? { client: trx } : {})
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .count('* as total')

    return Number(row.$extras.total)
  }

  /**
   * Everything the meters, the nav counters and the at-cap buttons render
   * from — the same numbers enforcement uses, never a second calculation
   * (plan §7.4).
   */
  async usage(organization: Organization): Promise<PlanUsage> {
    const [lists, seats] = await Promise.all([
      this.listCount(organization),
      seatUsage(organization),
    ])

    return {
      planKey: this.planKeyFor(organization),
      plan: this.planFor(organization),
      lists: this.describe(lists, this.limit(organization, 'lists')),
      seats: this.describe(seats.used, seats.limit),
    }
  }

  /**
   * Per-list todo usage, for the count pill on a list card and the disabled
   * *Add todo* button.
   *
   * Read from the denormalised `todos_count` rather than a `COUNT(*)`,
   * because this is rendered once per card on a grid and checked on every
   * todo create (plan §5.5).
   */
  todoUsage(organization: Organization, list: Pick<TodoList, 'todosCount'>): LimitUsage {
    return this.describe(list.todosCount, this.limit(organization, 'todosPerList'))
  }

  /**
   * The plan key a provider product id belongs to.
   *
   * The reverse of `plan.creemProductId`, and the only way a webhook can say
   * *which* plan was bought. An unrecognised product id returns null and the
   * caller keeps whatever plan the organisation already had — guessing here
   * would silently hand out the wrong entitlements.
   */
  planKeyForProductId(productId: string | null | undefined): PlanKey | null {
    if (!productId) {
      return null
    }

    for (const [key, plan] of Object.entries(plans)) {
      if (plan.creemProductId && plan.creemProductId === productId) {
        return key as PlanKey
      }
    }

    return null
  }

  /**
   * The paid plans, in price order — the plan grid on the billing screen.
   */
  purchasablePlans(): { key: PlanKey; plan: PlanDefinition }[] {
    return (Object.entries(plans) as [PlanKey, PlanDefinition][])
      .map(([key, plan]) => ({ key, plan }))
      .sort((a, b) => a.plan.priceCents - b.plan.priceCents)
  }

  /**
   * Move an organisation onto a plan.
   *
   * Only ever called from the webhook handler and from staff tooling: the
   * provider decides what somebody is entitled to, and a checkout return URL
   * a user can type by hand never does (plan §7.5).
   *
   * A downgrade writes the key and nothing else. No data job runs, nothing is
   * archived, and the next create is what surfaces the new ceiling — that is
   * the soft-lock (plan §7.4).
   */
  async applyPlan(organization: Organization, planKey: PlanKey): Promise<void> {
    if (organization.planKey === planKey) {
      return
    }

    organization.planKey = planKey
    await organization.save()
  }

  private describe(current: number, limit: number | null): LimitUsage {
    return {
      current,
      limit,
      remaining: limit === null ? null : Math.max(limit - current, 0),
      isFull: limit !== null && current >= limit,
      isNearLimit: limit !== null && limit > 0 && current / limit >= 0.8,
    }
  }
}

export default new PlanService()
