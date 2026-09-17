import type { LimitKey } from '#config/plans'
import type Organization from '#models/organization'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

/**
 * The quota registry (plan §7.3, §7.4).
 *
 * A quota is a limit in `config/plans.ts` plus two things that file cannot
 * hold: how to count what is using it, and the words a meter and a `402` use
 * for it.
 *
 * How a limit is *named* to a customer is not here: that belongs to the
 * limit, in `config/plans.ts`, because not every limit is a registered quota
 * (`apiKeys` is enforced without anything counting a table for it).
 *
 * It is a registry rather than a list inside `PlanService` for one reason.
 * Counting lists means querying `todo_lists`, so `PlanService` used to import
 * the demo domain's model — which made the billing layer depend on the demo
 * domain, and meant removing that domain broke enforcement for *every* quota
 * rather than only its own screens. Inverting it leaves `PlanService` owning
 * the arithmetic and knowing nothing about what is being counted.
 *
 * Nothing registers itself on import. Every quota this application has is
 * registered in `start/quotas.ts`, in the order the meters render them — an
 * explicit file, for the same reason `app/queue/registry.ts` is one: a quota
 * that silently stopped being registered would be a limit that silently
 * stopped being enforced.
 */
export interface QuotaDescriptor {
  /**
   * The `config/plans.ts` limit this quota is checked against. Typed as
   * `LimitKey`, so a quota cannot be registered for a limit no plan declares.
   */
  key: LimitKey

  /**
   * The meter's label, e.g. `Lists`.
   */
  label: string

  /**
   * How many are in use.
   *
   * Takes the transaction when it is called inside a create's own, which is
   * what `PlanService.lockAndAssertLimit` needs in order to read a count that
   * cannot change underneath it.
   *
   * Omitted for a limit with no single number per workspace: `todosPerList`
   * is a ceiling on each list, so there is nothing to meter, but it is still
   * a limit the API reports and a `402` can name.
   */
  count?: (organization: Organization, trx?: TransactionClientContract) => Promise<number> | number
}

export class QuotaRegistry {
  #quotas = new Map<LimitKey, QuotaDescriptor>()

  /**
   * Register a quota, or replace one already registered under the same key.
   *
   * Insertion order is preserved and is the order the meter grids render, so
   * `start/quotas.ts` is also where the dashboard's meters are ordered.
   */
  register(quota: QuotaDescriptor): this {
    this.#quotas.set(quota.key, quota)
    return this
  }

  all(): QuotaDescriptor[] {
    return [...this.#quotas.values()]
  }

  /**
   * The quotas with a counter — everything that can be metered.
   */
  counted(): QuotaDescriptor[] {
    return this.all().filter((quota) => quota.count !== undefined)
  }

  /**
   * The quotas without one — a declared ceiling with no workspace total.
   */
  declared(): QuotaDescriptor[] {
    return this.all().filter((quota) => quota.count === undefined)
  }

  get(key: string): QuotaDescriptor | undefined {
    return this.#quotas.get(key as LimitKey)
  }
}

export default new QuotaRegistry()
