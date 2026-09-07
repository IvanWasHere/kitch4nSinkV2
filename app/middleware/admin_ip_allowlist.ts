import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import env from '#start/env'

/**
 * Restricts the back-office to a set of addresses (plan §12).
 *
 * Off unless `ADMIN_IP_ALLOWLIST` is set, because a boilerplate that locks
 * you out of your own admin panel on first run is a boilerplate people delete.
 * Set it in production and the whole of `/admin` — including its login page —
 * stops existing for everybody else.
 *
 * Deliberately a *second* layer, not the security boundary. The staff guard
 * and mandatory two-factor are what actually protect this; an allowlist only
 * shrinks the surface, and it is trivially defeated by anything that can
 * spoof a proxy header. That is why the refusal is a **404**: an attacker
 * probing for an admin panel learns nothing, and a legitimate operator on the
 * wrong network gets an unambiguous "not here" rather than a hint to try
 * harder.
 */
export default class AdminIpAllowlistMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const allowlist = this.allowlist()

    if (allowlist.length === 0) {
      return next()
    }

    const ip = ctx.request.ip()

    if (allowlist.includes(ip)) {
      return next()
    }

    logger.warn(
      { ip, url: ctx.request.url() },
      'refused a back-office request from outside the allowlist'
    )

    return ctx.response.notFound('Not found')
  }

  private allowlist(): string[] {
    return (env.get('ADMIN_IP_ALLOWLIST', '') || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
}
