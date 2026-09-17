import env from '#start/env'

/**
 * Plan tiers and their limits (D3, plan §7.3).
 *
 * Limits live in code, not in a table: changing what a plan allows is a typed
 * change with a diff and a test, not a migration and a data fix. Gating is a
 * pure function over `organization.planKey` — no network call, no database
 * read.
 *
 * Two magic values, and the difference matters:
 *   `null` — unlimited.
 *   `0`    — not available on this plan at all, so the feature's screen is
 *            hidden rather than shown empty.
 */
export interface PlanLimits {
  seats: number | null
  lists: number | null
  todosPerList: number | null
  storageMb: number | null
  apiKeys: number | null
  apiCallsPerMonth: number | null
}

export interface PlanDefinition {
  name: string
  priceCents: number
  interval: 'month' | null
  creemProductId: string | null
  limits: PlanLimits
  features: readonly string[]
}

export const plans = {
  free: {
    name: 'Free',
    priceCents: 0,
    interval: null,
    creemProductId: null,
    limits: {
      seats: 2,
      lists: 3,
      todosPerList: 50,
      storageMb: 100,
      apiKeys: 0,
      apiCallsPerMonth: 0,
    },
    features: [],
  },
  pro: {
    name: 'Pro',
    priceCents: 2900,
    interval: 'month',
    creemProductId: env.get('CREEM_PRODUCT_PRO') ?? null,
    limits: {
      seats: 10,
      lists: 25,
      todosPerList: 500,
      storageMb: 5_000,
      apiKeys: 5,
      apiCallsPerMonth: 50_000,
    },
    features: ['api', 'customBranding', 'prioritySupport'],
  },
  business: {
    name: 'Business',
    priceCents: 9900,
    interval: 'month',
    creemProductId: env.get('CREEM_PRODUCT_BUSINESS') ?? null,
    limits: {
      seats: 50,
      lists: null,
      todosPerList: null,
      storageMb: 100_000,
      apiKeys: 25,
      apiCallsPerMonth: 1_000_000,
    },
    features: ['api', 'customBranding', 'prioritySupport', 'sso', 'auditExport'],
  },
} as const satisfies Record<string, PlanDefinition>

export type PlanKey = keyof typeof plans
export type LimitKey = keyof (typeof plans)['free']['limits']
export type FeatureKey = (typeof plans)[PlanKey]['features'][number]

export const DEFAULT_PLAN: PlanKey = 'free'

/**
 * Every limit key, in the order `PlanLimits` declares them.
 *
 * Derived from the catalogue rather than written out a second time. The staff
 * override form and `overrideLimits`' own `limit in plans.free.limits` check
 * then read the same list, so a limit that arrives with a feature — or leaves
 * with one — cannot leave the form offering a key the controller rejects.
 */
export const LIMIT_KEYS = Object.keys(plans[DEFAULT_PLAN].limits) as LimitKey[]

/**
 * How each limit is named to a customer.
 *
 * Here rather than in the quota registry because a noun belongs to the
 * *limit*, and not every limit is a registered quota: `apiKeys` and
 * `apiCallsPerMonth` are enforced and metered without anything counting a
 * tenant-owned table for them. Typed as an exhaustive `Record<LimitKey, …>`,
 * so adding a limit without a word for it is a compile error rather than a
 * `402` that says "you have used all 5 apiKeys".
 *
 * Lower case and plural: each is dropped into "Your plan allows 3 …".
 */
export const LIMIT_NOUNS: Record<LimitKey, string> = {
  seats: 'seats',
  lists: 'lists',
  todosPerList: 'todos in a list',
  storageMb: 'MB of storage',
  apiKeys: 'API keys',
  apiCallsPerMonth: 'API calls this month',
}

/**
 * The noun for a limit, falling back to the key for a string that is not one
 * — an ugly message is a better failure than a 500 on top of a 402.
 */
export function nounFor(limit: string): string {
  return LIMIT_NOUNS[limit as LimitKey] ?? limit
}

/**
 * The limits the plan grid lists, in the order it lists them.
 *
 * Separate from `LIMIT_NOUNS` because the two are read in different
 * sentences: a `402` says "your plan allows 500 todos in a list", while a
 * pricing card says "500 todos per list". A limit absent from here is
 * enforced and metered without being advertised — `apiKeys` is sold as the
 * `api` feature rather than as a number.
 *
 * Typed on `LimitKey`, so a limit that leaves with its feature makes the
 * entry here a compile error instead of a card that renders `undefined`.
 */
export const PLAN_CARD_LIMITS: readonly {
  key: LimitKey
  /**
   * The words after the number, e.g. `todos per list`.
   */
  label: string
  /**
   * How the number reads, where it is not simply the number. Storage is
   * stored in megabytes because that is the resolution it is enforced at, and
   * shown in gigabytes because that is how it is sold.
   */
  format?: (value: number) => string
}[] = [
  { key: 'seats', label: 'seats' },
  { key: 'lists', label: 'lists' },
  { key: 'todosPerList', label: 'todos per list' },
  { key: 'storageMb', label: 'storage', format: (mb) => `${mb / 1000} GB` },
]

/**
 * One line per limit the grid advertises and this plan declares.
 *
 * A limit the plan does not declare at all is skipped rather than shown as
 * zero: a build with a feature removed should show a shorter card, not a card
 * offering none of something nobody sells.
 */
export function planCardLines(limits: PlanLimits): string[] {
  return PLAN_CARD_LIMITS.filter(({ key }) => limits[key] !== undefined).map(
    ({ key, label, format }) => {
      const value = limits[key]
      const amount = value === null ? 'Unlimited' : format ? format(value) : String(value)

      return `${amount} ${label}`
    }
  )
}

/**
 * Whether any of a plan's limits is unlimited — the "stopped counting" tier.
 *
 * Asked this way rather than by naming a limit, so the top plan's copy does
 * not depend on the demo domain declaring `lists: null`.
 */
export function hasUnlimitedLimit(limits: PlanLimits): boolean {
  return Object.values(limits).some((value) => value === null)
}

/**
 * The plan for an organisation, falling back to Free for an unrecognised key
 * — a plan removed from this file must not lock a customer out of their data.
 */
export function planFor(planKey: string): PlanDefinition {
  return plans[planKey as PlanKey] ?? plans[DEFAULT_PLAN]
}

/**
 * A single limit for an organisation.
 *
 * `limitOverrides` is the staff escape hatch (plan §7.4) — "just let this
 * customer have five more seats while we sort out billing" — merged over the
 * plan's own limits.
 *
 * M4 moves this behind PlanService along with entitlement checks, usage
 * meters and the 402 response shape. It lives here now because seat
 * enforcement (M2) needs exactly this and nothing more.
 */
export function limitFor(
  organization: { planKey: string; limitOverrides: Record<string, number | null> | null },
  limit: LimitKey
): number | null {
  const override = organization.limitOverrides?.[limit]

  if (override !== undefined) {
    return override
  }

  return planFor(organization.planKey).limits[limit]
}
