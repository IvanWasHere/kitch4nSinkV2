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

import '#start/routes/auth'
import '#start/routes/web'
import '#start/routes/billing'
import '#start/routes/api'
import '#start/routes/admin'

router.on('/').render('pages/home').as('home')

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
