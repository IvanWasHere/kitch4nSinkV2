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

router
  .group(() => {
    router
      .get('/organization', [controllers.api.v1.Organization, 'show'])
      .as('api.organization.show')
    router.get('/members', [controllers.api.v1.Organization, 'members']).as('api.members.index')

    router.get('/lists', [controllers.api.v1.List, 'index']).as('api.lists.index')
    router.post('/lists', [controllers.api.v1.List, 'store']).as('api.lists.store')
    router.get('/lists/:id', [controllers.api.v1.List, 'show']).as('api.lists.show')
    router.patch('/lists/:id', [controllers.api.v1.List, 'update']).as('api.lists.update')
    router.delete('/lists/:id', [controllers.api.v1.List, 'destroy']).as('api.lists.destroy')

    router.get('/lists/:listId/todos', [controllers.api.v1.Todo, 'index']).as('api.todos.index')
    router.post('/lists/:listId/todos', [controllers.api.v1.Todo, 'store']).as('api.todos.store')

    router.get('/todos/:id', [controllers.api.v1.Todo, 'show']).as('api.todos.show')
    router.patch('/todos/:id', [controllers.api.v1.Todo, 'update']).as('api.todos.update')
    router
      .post('/todos/:id/complete', [controllers.api.v1.Todo, 'complete'])
      .as('api.todos.complete')
    router
      .post('/todos/:id/uncomplete', [controllers.api.v1.Todo, 'uncomplete'])
      .as('api.todos.uncomplete')
    router.delete('/todos/:id', [controllers.api.v1.Todo, 'destroy']).as('api.todos.destroy')
  })
  .prefix('/api/v1')
  .use([middleware.trackApiUsage(), middleware.apiKeyAuth(), middleware.apiRateLimit()])
