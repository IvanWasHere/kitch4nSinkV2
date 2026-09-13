/*
|--------------------------------------------------------------------------
| HTTP kernel file
|--------------------------------------------------------------------------
|
| The HTTP kernel file is used to register the middleware with the server
| or the router.
|
*/

import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

import { serverStatsEnabled } from '#start/dev_toolbar'

/**
 * The error handler is used to convert an exception
 * to an HTTP response.
 */
server.errorHandler(() => import('#exceptions/handler'))

/**
 * The server middleware stack runs middleware on all the HTTP
 * requests, even if there is no route registered for
 * the request URL.
 */
server.use([
  () => import('#middleware/container_bindings_middleware'),

  /**
   * Request timing and tracing for the development toolbar
   * (`#start/dev_toolbar`), guarded because the package is a devDependency
   * and is absent from the runtime image.
   *
   * Near the top of the stack so the duration it reports is the one the
   * browser waited, not the fraction left after the middleware below it have
   * run. Still inside the container bindings, because the per-request
   * timeline it builds resolves services out of the request container.
   */
  ...(serverStatsEnabled ? [() => import('adonisjs-server-stats/middleware')] : []),

  /**
   * Outermost, so the headers are on every response including the ones no
   * route produced (plan §16).
   */
  () => import('#middleware/security_headers'),
  () => import('@adonisjs/static/static_middleware'),
  () => import('@adonisjs/vite/vite_middleware'),
])

/**
 * The router middleware stack runs middleware on all the HTTP
 * requests with a registered route.
 */
router.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
  () => import('@adonisjs/session/session_middleware'),
  () => import('@adonisjs/shield/shield_middleware'),
  () => import('@adonisjs/auth/initialize_auth_middleware'),
  () => import('#middleware/silent_auth_middleware'),
  () => import('#middleware/initialize_bouncer_middleware'),

  /**
   * Impersonation is enforced on **every** request rather than on the tenant
   * route group, so its expiry and its read-only rule cannot be escaped by a
   * route that forgot to opt in (plan §6).
   */
  () => import('#middleware/impersonation'),
])

/**
 * Named middleware collection must be explicitly assigned to
 * the routes or the routes group.
 */
export const middleware = router.named({
  guest: () => import('#middleware/guest_middleware'),
  auth: () => import('#middleware/auth_middleware'),
  verifiedEmail: () => import('#middleware/ensure_verified_email'),
  organization: () => import('#middleware/require_organization'),
  owner: () => import('#middleware/require_owner'),
  staffAuth: () => import('#middleware/staff_auth'),
  staffGuest: () => import('#middleware/staff_guest'),

  /**
   * The organisation API (plan §11). Order matters and is fixed by the route
   * group: usage tracking outermost so a 401 is still recorded, then
   * authentication, then the rate limiter, which needs the key to limit on.
   */
  trackApiUsage: () => import('#middleware/track_api_usage'),
  apiKeyAuth: () => import('#middleware/api_key_auth'),
  apiRateLimit: () => import('#middleware/api_rate_limit'),

  /**
   * The back-office (plan §12). The allowlist runs before the guard, so an
   * address that is not permitted never even sees the login page.
   */
  adminIpAllowlist: () => import('#middleware/admin_ip_allowlist'),
})
