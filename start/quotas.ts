/*
|--------------------------------------------------------------------------
| Quota registry
|--------------------------------------------------------------------------
|
| Every quota this application enforces, in the order the meter grids render
| them (plan §7.3, §7.4).
|
| A quota is a limit from `config/plans.ts` plus how to count what is using
| it and what to label its meter. How a limit is *named* in a `402` lives
| beside the limit itself, in `LIMIT_NOUNS`. `PlanService` owns the arithmetic — the amber-at-80% rule, the `>=`
| that makes a downgraded workspace read as full, the row lock inside a
| create — and knows nothing about what is being counted. This file is where
| the two meet.
|
| An explicit file rather than each feature registering itself on import, for
| the reason `app/queue/registry.ts` is one: a quota that silently stopped
| being registered would be a limit that silently stopped being enforced, and
| the first person to notice would be a customer on the wrong side of it.
|
| **Removing a feature means deleting its lines here** — see
| `docs/modules.md`. Nothing else needs to change: the meter grids, the
| at-cap banner and the API's usage payload all iterate what is registered.
|
*/

import quotas from '#billing/quotas'
import plans from '#billing/plan_service'
import lists from '#todos/list_service'
import { seatUsage } from '#organizations/seats'

/**
 * The demo domain (D8) — delete with it.
 *
 * `lists` is registered first only because it renders first. `todosPerList`
 * has no counter: it is a ceiling on each list rather than on the workspace,
 * so there is no one number to meter, but registering it is what lets a `402`
 * name it and the API report it.
 */
quotas.register({
  key: 'lists',
  label: 'Lists',
  count: (organization, trx) => lists.count(organization, trx),
})

quotas.register({
  key: 'todosPerList',
  label: 'Todos per list',
})

/**
 * Core quotas. Seats are members plus outstanding invitations (plan §5.5) —
 * counting only members would let ten invitations to a two-seat plan all
 * succeed. Storage is read from the counter on the organisation row rather
 * than summed, the same rule `todos_count` follows (plan §10).
 */
quotas.register({
  key: 'seats',
  label: 'Seats',
  count: async (organization, trx) => {
    const seats = await seatUsage(organization, trx)

    return seats.used
  },
})

quotas.register({
  key: 'storageMb',
  label: 'Storage (MB)',
  count: (organization) => plans.storageMbUsed(organization),
})

/**
 * `apiKeys` and `apiCallsPerMonth` are deliberately absent.
 *
 * Both are enforced against `config/plans.ts` and both render a meter, but
 * their numbers come from `ApiKeyService` and the usage rollup rather than
 * from a count over a tenant-owned table, and neither belongs on the grid
 * that every screen shows. They go through `PlanService.describeCount`
 * instead, which is the same arithmetic without the registration.
 */
