/*
|--------------------------------------------------------------------------
| Organisation API — /api/v1 (plan §11)
|--------------------------------------------------------------------------
|
| JSON only, versioned by URL segment, authenticated by an organisation API
| key. **The key is the scope**: no route here accepts an organisation id, so
| there is nothing for a caller to forge and no endpoint that can be pointed
| at another tenant.
|
| Middleware order is deliberate:
|
|   trackApiUsage  — outermost, so a 401 or a 402 is recorded too. Those are
|                    exactly the responses somebody asks support about.
|   apiKeyAuth     — authenticates and puts the organisation on the context.
|   apiRateLimit   — needs the key, so it runs after auth.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import { registerListApiRoutes } from '#modules/lists/routes'

router
  .group(() => {
    router
      .get('/organization', [controllers.api.v1.Organization, 'show'])
      .as('api.organization.show')
    router.get('/members', [controllers.api.v1.Organization, 'members']).as('api.members.index')

    /**
     * The demo domain's endpoints (D8) — two lines to remove with it.
     */
    registerListApiRoutes()
  })
  .prefix('/api/v1')
  .use([middleware.trackApiUsage(), middleware.apiKeyAuth(), middleware.apiRateLimit()])
