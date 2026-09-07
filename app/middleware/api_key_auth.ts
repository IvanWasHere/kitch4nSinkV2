import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import type ApiKey from '#models/api_key'
import plans from '#billing/plan_service'
import apiKeys from '#api/api_key_service'
import { parseAuthorizationHeader } from '#api/keys'
import { ApiInsufficientScopeException, ApiUnauthorizedException } from '#api/errors'
import UpgradeRequiredException from '#exceptions/upgrade_required_exception'
import type { ApiScope } from '#api/scopes'

/**
 * Authenticates an organisation API key (plan §11).
 *
 * The sequence, and every step of it matters:
 *
 * 1. Parse `Authorization: Bearer sk_…`. A malformed header costs one regex,
 *    not a database lookup.
 * 2. Look up by **hash**. The plaintext is never compared against anything
 *    and never stored.
 * 3. Reject revoked or expired keys — with the *same* 401 as an unknown key,
 *    so somebody who found a key cannot probe whether it is still live.
 * 4. Check the plan includes the `api` feature. A workspace that downgrades
 *    stops being able to call the API without anybody having to revoke its
 *    keys.
 * 5. Put the organisation on the context. **The key is the scope** — no
 *    endpoint accepts an organisation id, so there is nothing to forge.
 * 6. Stamp `last_used_at`, throttled to once a minute.
 */
export default class ApiKeyAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const secret = parseAuthorizationHeader(ctx.request.header('authorization'))

    if (!secret) {
      throw new ApiUnauthorizedException()
    }

    const authenticated = await apiKeys.authenticate(secret)

    if (!authenticated) {
      throw new ApiUnauthorizedException()
    }

    const { apiKey, organization } = authenticated

    /**
     * Put on the context *before* the entitlement check, not after.
     *
     * The key authenticated — we know whose request this is — and it is the
     * plan that refuses it. Attributing it here is what lets the usage
     * tracker record the 402, which is precisely the response a customer
     * will be asking support about ("your API stopped working").
     */
    ctx.organization = organization
    ctx.apiKey = apiKey

    /**
     * Checked on every request rather than only at key creation, because a
     * plan can change between the two — a cancelled subscription must close
     * the API immediately, not at the next key rotation.
     */
    if (!plans.can(organization, 'api')) {
      throw new UpgradeRequiredException('api')
    }

    await apiKeys.touch(apiKey)

    return next()
  }
}

/**
 * Requires a scope on the authenticated key.
 *
 * A function rather than a second middleware class, so a route reads
 * `[Controller, 'store']` with its scope right next to it and the two cannot
 * drift apart in separate files.
 */
export function requireScope(ctx: HttpContext, scope: ApiScope): void {
  if (!ctx.apiKey?.can(scope)) {
    throw new ApiInsufficientScopeException(scope)
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    /**
     * Present on API requests only. Its absence on a web request is what
     * stops a scope check from silently passing there.
     */
    apiKey?: ApiKey
  }
}
