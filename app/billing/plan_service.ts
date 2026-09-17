import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import Organization from '#models/organization'
import quotas from '#billing/quotas'
import UpgradeRequiredException from '#exceptions/upgrade_required_exception'
import PlanLimitExceededException from '#exceptions/plan_limit_exceeded_exception'
import {
  DEFAULT_PLAN,
  limitFor,
  nounFor,
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

/**
 * One quota's usage, carrying enough to render a meter without a second
 * lookup for its label.
 */
export interface QuotaUsage extends LimitUsage {
  key: LimitKey
  label: string
  noun: string
}

/**
 * A limit with no workspace total — see `QuotaDescriptor.count`.
 */
export interface DeclaredLimit {
  key: LimitKey
  label: string
  noun: string
  limit: number | null
}

export interface PlanUsage {
  planKey: PlanKey
  plan: PlanDefinition

  /**
   * Counted quotas by key, for a screen that wants one of them by name —
   * `usage.quotas.lists` on the Lists screen.
   *
   * Every value is optional because a quota is present only while whatever
   * registered it is (`start/quotas.ts`). Screens that belong to a feature
   * can rely on that feature's quota; shared screens must not.
   */
  quotas: Partial<Record<LimitKey, LimitUsage>>

  /**
   * The same quotas in registration order, for the meter grids. Iterating
   * this is what lets a quota be added or removed without touching a
   * template.
   */
  meters: QuotaUsage[]

  /**
   * Registered limits that are not counted per workspace. The API reports
   * these as a ceiling with no usage.
   */
  declared: DeclaredLimit[]

  /**
   * The quotas that are full, for the at-cap banner. Derived from `meters`
   * rather than recomputed, so the banner and the block can never disagree.
   */
  atCap: QuotaUsage[]
}

/**
 * One megabyte, as the `storageMb` limit means it. Binary, because that is
 * what every file manager the customer will compare against shows.
 */
export const BYTES_PER_MB = 1024 * 1024

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
   * The count for one registered quota.
   *
   * Goes through the registry so that the row-locked check inside a create
   * and the meter on the dashboard call the same counter — the point of one
   * class is undone the moment a caller counts something itself.
   */
  async countFor(
    key: LimitKey,
    organization: Organization,
    trx?: TransactionClientContract
  ): Promise<number> {
    const quota = quotas.get(key)

    if (!quota?.count) {
      throw new Error(`No counted quota is registered for "${key}" (see start/quotas.ts)`)
    }

    return quota.count(organization, trx)
  }

  /**
   * Everything the meters, the nav counters and the at-cap buttons render
   * from — the same numbers enforcement uses, never a second calculation
   * (plan §7.4).
   *
   * One query per counted quota, in parallel, against indexed
   * `organization_id` columns. This runs on every rendered page
   * (`RequireOrganizationMiddleware`), which is the reason a quota's counter
   * has to stay a single count and not grow into a scan.
   */
  async usage(organization: Organization): Promise<PlanUsage> {
    const counted = quotas.counted()

    const counts = await Promise.all(counted.map((quota) => quota.count!(organization)))

    const byKey: Partial<Record<LimitKey, LimitUsage>> = {}

    const meters = counted.map((quota, index): QuotaUsage => {
      const described = this.describe(counts[index], this.limit(organization, quota.key))

      byKey[quota.key] = described

      return { key: quota.key, label: quota.label, noun: nounFor(quota.key), ...described }
    })

    return {
      planKey: this.planKeyFor(organization),
      plan: this.planFor(organization),
      quotas: byKey,
      meters,
      declared: quotas.declared().map((quota) => ({
        key: quota.key,
        label: quota.label,
        noun: nounFor(quota.key),
        limit: this.limit(organization, quota.key),
      })),
      atCap: meters.filter((meter) => meter.isFull),
    }
  }

  /**
   * Storage, in whole megabytes, for the meter.
   *
   * Read from `organizations.storage_used_bytes` — moved in the same
   * transaction as every `files` insert and delete, the same rule
   * `todos_count` follows (plan §10). Rounded **up**, so a workspace holding
   * a single 1-byte file does not read as using nothing.
   */
  storageUsage(organization: Organization): LimitUsage {
    return this.describe(this.storageMbUsed(organization), this.limit(organization, 'storageMb'))
  }

  /**
   * The same number, unwrapped — what the registered `storageMb` quota counts
   * with (`start/quotas.ts`). Separate so the rounding rule above is written
   * once and the meter and the quota cannot round differently.
   */
  storageMbUsed(organization: Organization): number {
    return Math.ceil(organization.storageUsedBytes / BYTES_PER_MB)
  }

  /**
   * Whether another `additionalBytes` would fit.
   *
   * Compared in **bytes** and reported in megabytes. Comparing the rounded
   * megabytes instead would let a 100 MB plan hold 100.9 MB, or refuse a file
   * that fits — the limit is a number a customer is paying for, so it is
   * enforced at the resolution the data actually has.
   */
  assertStorageWithinLimit(organization: Organization, additionalBytes: number): void {
    const allowedMb = this.limit(organization, 'storageMb')

    if (allowedMb === null) {
      return
    }

    const used = organization.storageUsedBytes
    const allowedBytes = allowedMb * BYTES_PER_MB

    if (used + additionalBytes <= allowedBytes) {
      return
    }

    throw new PlanLimitExceededException({
      limit: 'storageMb',
      allowed: allowedMb,
      current: Math.ceil(used / BYTES_PER_MB),
    })
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

  /**
   * Shape a count the meters understand.
   *
   * Public because M6's API-key screen counts something this class does not
   * own — the rows live in `ApiKeyService` — and it must still render through
   * the same meter, with the same amber-at-80% rule, as every other quota.
   */
  describeCount(current: number, limit: number | null): LimitUsage {
    return this.describe(current, limit)
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
