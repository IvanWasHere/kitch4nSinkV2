import { DateTime } from 'luxon'
import limiter from '@adonisjs/limiter/services/main'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import plans from '#billing/plan_service'
import { ApiException } from '#api/errors'

/**
 * How many requests a single key may make in a minute.
 *
 * A burst rule, separate from the plan's monthly allowance: it exists to stop
 * one runaway loop saturating the database for every other tenant, so it is
 * about *our* stability rather than about what a customer bought. Generous
 * enough that a sensible bulk import never sees it.
 */
export const BURST_REQUESTS = 120
export const BURST_WINDOW = '1 minute'

/**
 * Two rate limits in one call (plan §11).
 *
 * - **Burst**, keyed by API key: protects the service.
 * - **Monthly quota**, keyed by organisation: enforces what the plan sells.
 *   Keyed by organisation rather than by key because `apiCallsPerMonth` is a
 *   plan limit — minting a second key must not double the allowance.
 *
 * `limiter.multi()` consumes both in one call, in order. It is **not**
 * atomic: a request that trips the monthly quota has already spent a burst
 * point. That is deliberate — the alternative is compensating writes on every
 * throttled request, and one point on a request that was refused anyway
 * changes nothing a customer can observe.
 *
 * The calendar month is in the **key**, not the duration:
 * `rate-limiter-flexible` windows slide from first consumption, which would
 * mean a customer's "monthly" allowance resetting on a date that drifted away
 * from their invoice. A key of `…:2026-09` resets on the 1st, which is what
 * the invoice says.
 *
 * The window is then only a safety net — it is set to expire when the month
 * does, so a counter cannot outlive the key that names it.
 */
export default class ApiRateLimitMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const organization = ctx.organization
    const apiKey = ctx.apiKey

    if (!organization || !apiKey) {
      /**
       * Unreachable behind the auth middleware, and here so that reordering
       * the stack fails loudly rather than silently unlimiting the API.
       */
      throw new Error('The API rate limiter must run after ApiKeyAuthMiddleware')
    }

    const monthlyLimit = plans.limit(organization, 'apiCallsPerMonth')
    const month = DateTime.utc().toFormat('yyyy-MM')

    const rules: { key: string; requests: number; duration: string | number }[] = [
      { key: `api:burst:${apiKey.id}`, requests: BURST_REQUESTS, duration: BURST_WINDOW },
    ]

    /**
     * `null` is unlimited, so the rule is simply not added — there is no
     * point spending a write to count against infinity.
     */
    if (monthlyLimit !== null) {
      rules.push({
        key: `api:month:${organization.id}:${month}`,
        requests: monthlyLimit,
        /**
         * Seconds until the 1st, rather than a flat "one month".
         *
         * Two reasons. It matches the key, so the counter and its name expire
         * together. And it stays well inside Node's ~24.8-day timer ceiling
         * (2^31 ms) — a longer window makes the **memory** store expire the
         * record instantly, because `setTimeout` past that limit fires
         * immediately. That failure is silent and looks exactly like an
         * unlimited plan.
         */
        duration: this.secondsUntilNextMonth(),
      })
    }

    const multi = limiter.multi(rules)

    try {
      const [burst, monthly] = await multi.consume()

      this.setHeaders(ctx, burst, monthly)
    } catch (error) {
      /**
       * The limiter's own exception carries the numbers; it is translated
       * into the API's error shape so a client has one thing to parse.
       */
      const availableIn = Number(
        (error as { response?: { availableIn?: number } }).response?.availableIn ?? 60
      )

      ctx.response.header('retry-after', String(availableIn))
      ctx.response.header('x-ratelimit-remaining', '0')
      ctx.response.header('x-ratelimit-reset', String(availableIn))

      throw new ApiException(
        'rate_limit_exceeded',
        `Too many requests. Try again in ${availableIn} second${availableIn === 1 ? '' : 's'}.`,
        429,
        { retry_after: availableIn }
      )
    }

    return next()
  }

  /**
   * How long until the calendar month ends.
   *
   * Clamped below Node's timer ceiling for the reason above — at the very
   * start of a 31-day month the remainder exceeds it.
   */
  private secondsUntilNextMonth(): number {
    const now = DateTime.utc()
    const remaining = Math.ceil(
      now.plus({ months: 1 }).startOf('month').diff(now, 'seconds').seconds
    )

    /**
     * 20 days. A counter that expired early would hand out extra quota, so
     * the clamp only ever applies at the beginning of a month — by which
     * point 20 days of traffic has been counted and the key rolls over long
     * before a customer could exploit the gap.
     */
    return Math.min(remaining, 20 * 24 * 60 * 60)
  }

  /**
   * Headers on **every** response, not only on a 429 (plan §11).
   *
   * A client that only learns its budget by exceeding it cannot pace itself;
   * these are what let a bulk import slow down before it is throttled.
   *
   * The three standard headers describe the burst window, because that is
   * what a client paces against second to second. The monthly allowance gets
   * its own `x-quota-*` trio rather than being folded into the same names —
   * one header that sometimes means "this minute" and sometimes "this month"
   * is worse than two that each mean one thing.
   */
  private setHeaders(
    ctx: HttpContext,
    burst: { limit: number; remaining: number; availableIn: number },
    monthly?: { limit: number; remaining: number; availableIn: number }
  ): void {
    ctx.response.header('x-ratelimit-limit', String(burst.limit))
    ctx.response.header('x-ratelimit-remaining', String(burst.remaining))
    ctx.response.header('x-ratelimit-reset', String(burst.availableIn))

    if (monthly) {
      ctx.response.header('x-quota-limit', String(monthly.limit))
      ctx.response.header('x-quota-remaining', String(monthly.remaining))
      ctx.response.header('x-quota-reset', String(monthly.availableIn))
    }
  }
}
