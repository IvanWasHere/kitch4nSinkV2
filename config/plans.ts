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
