import router from '@adonisjs/core/services/router'
import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

import type { LimitKey } from '#config/plans'

export interface PlanLimitDetails {
  limit: LimitKey
  allowed: number
  current: number
}

/**
 * A create blocked by a plan limit (plan §7.4).
 *
 * **Soft-lock**: this is only ever thrown by a *create*. An organisation over
 * its limit keeps every row it has, readable and editable, so a failed card
 * or a downgrade costs a customer nothing and re-upgrading needs no restore
 * job.
 *
 * A blocked create is never a dead end. Both renderings say which limit was
 * hit, what the ceiling is and where to raise it:
 *
 * - **API** — `402` with a machine-readable `limit` key, so a customer's
 *   integration can branch on it instead of retry-looping against a wall.
 * - **Web** — a flash carrying the same numbers, which the page turns into
 *   the inline `.plan-card` upsell.
 */
export default class PlanLimitExceededException extends Exception {
  static status = 402
  static code = 'E_PLAN_LIMIT_EXCEEDED'

  constructor(readonly details: PlanLimitDetails) {
    super(PlanLimitExceededException.messageFor(details), {
      status: PlanLimitExceededException.status,
      code: PlanLimitExceededException.code,
    })
  }

  /**
   * Written for the customer, not for the log. It names the ceiling and the
   * usage, because "you have reached your limit" with no numbers is the least
   * useful thing an upsell can say.
   */
  static messageFor({ limit, allowed, current }: PlanLimitDetails): string {
    const nouns: Record<string, string> = {
      seats: 'seats',
      lists: 'lists',
      todosPerList: 'todos in a list',
      storageMb: 'MB of storage',
      apiKeys: 'API keys',
      apiCallsPerMonth: 'API calls this month',
    }

    const noun = nouns[limit] ?? limit

    if (allowed === 0) {
      return `${noun[0].toUpperCase()}${noun.slice(1)} are not included in your plan.`
    }

    return `Your plan allows ${allowed} ${noun}, and you are using ${current}.`
  }

  get upgradeUrl(): string {
    return router.find('billing.index') ? router.makeUrl('billing.index') : '/billing'
  }

  async handle(error: this, ctx: HttpContext) {
    const body = {
      error: {
        code: 'plan_limit_exceeded',
        message: error.message,
        limit: error.details.limit,
        allowed: error.details.allowed,
        current: error.details.current,
        upgradeUrl: error.upgradeUrl,
      },
    }

    if (ctx.request.accepts(['html', 'json']) === 'json') {
      return ctx.response.status(402).send(body)
    }

    /**
     * The numbers travel with the flash so the page can render the upsell
     * inline rather than only a toast — the same shape the API returns, so
     * the two cannot describe the block differently.
     */
    ctx.session.flash('error', error.message)
    ctx.session.flash('planLimit', body.error)

    return ctx.response.redirect().back()
  }
}
