/*
|--------------------------------------------------------------------------
| Landing — routes (plan §22.7)
|--------------------------------------------------------------------------
|
| Called from `start/routes.ts`, which first registers its own `/` — the
| fallback that sends people to sign in — and hands it over to be replaced.
| Taking over an existing route rather than racing to register one is what
| lets removal be a deletion: drop the call, and the fallback simply stays.
|
*/

import router from '@adonisjs/core/services/router'
import type { Route } from '@adonisjs/core/http'
import { controllers } from '#generated/controllers'

export function registerLandingRoutes(options: { replacing: Route }) {
  /**
   * Same pattern, same name. Every layout and error page links to `home`, so
   * whichever route answers `/` has to carry it.
   */
  options.replacing.markAsDeleted()
  router.get('/', [controllers.landing.Landing, 'home']).as('home')

  router.get('/privacy', [controllers.landing.Landing, 'privacy']).as('legal.privacy')
  router.get('/terms', [controllers.landing.Landing, 'terms']).as('legal.terms')
}
