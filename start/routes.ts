/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| Routes are registered per area, one file each (plan §4). Import order is
| the order they are matched in.
|
*/

import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import { registerContentPageRoutes, registerContentPostRoutes } from '#modules/content/routes'
import { registerLandingRoutes } from '#modules/landing/routes'

import '#start/routes/auth'
import '#start/routes/web'
import '#start/routes/billing'
import '#start/routes/api'
import '#start/routes/admin'

/**
 * The front door (plan §22.7). Core's own `/` only sends people inward — to
 * the workspace, or to sign in — and is named `home` because every layout and
 * error page links to that name.
 *
 * The Landing module takes this route over and puts the marketing page and the
 * legal pages in its place. Removing the module is deleting that call and its
 * import; this fallback is then what answers.
 *
 * Exported only so that it is not an unused variable once that call is gone —
 * removal stays a deletion, with nothing to rewrite.
 */
export const home = router.get('/', [controllers.Home, 'index']).as('home')
registerLandingRoutes({ replacing: home })

/**
 * Liveness and readiness (plan §16). Unauthenticated by necessity — the
 * thing polling them is a load balancer with no session — and deliberately
 * uninformative to anybody who is not one.
 */
router.get('/health', [controllers.Health, 'live']).as('health.live')
router.get('/ready', [controllers.Health, 'ready']).as('health.ready')

/**
 * API documentation (plan §11). Public on purpose: somebody deciding whether
 * to build against this needs to read it before they have a key.
 */
router.get('/docs', [controllers.docs.Docs, 'index']).as('docs.index')
router.get('/openapi.json', [controllers.docs.Docs, 'openapi']).as('docs.openapi')

/**
 * The component library, rendered against the design tokens. Development only
 * — it is a review surface, not a page anyone should reach in production.
 */
if (app.inDev) {
  router.on('/styleguide').render('pages/dev/styleguide').as('styleguide')
}

/**
 * Content (plan §22.6): the blog, then pages at the root.
 *
 * **Keep these last.** `/:slug` answers any one-segment path, so it must be
 * registered after everything it could otherwise swallow. Removing the module
 * is these two calls and the import.
 */
registerContentPostRoutes()
registerContentPageRoutes()
