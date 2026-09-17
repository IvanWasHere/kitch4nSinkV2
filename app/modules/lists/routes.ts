/*
|--------------------------------------------------------------------------
| Lists and todos — routes (D8)
|--------------------------------------------------------------------------
|
| Exported as functions rather than registered on import, and called from
| inside the groups in `start/routes/web.ts` and `start/routes/api.ts`.
|
| That is deliberate. Both groups carry a middleware stack — a verified,
| signed-in tenant session for the web, and key auth plus usage tracking and
| rate limiting for the API — and it is the uniformity of those stacks that
| makes it impossible to add a screen or an endpoint that forgets to scope
| itself to an organisation. A module that registered its own group would be
| a module that could get that wrong privately.
|
| Nothing here accepts an organisation id; the session or the key decides it.
|
*/

import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

/**
 * The web screens (plan §13.6.2).
 */
export function registerListWebRoutes() {
  router.get('/lists', [controllers.lists.List, 'index']).as('lists.index')
  router.post('/lists', [controllers.lists.List, 'store']).as('lists.store')
  router.get('/lists/:id', [controllers.lists.List, 'show']).as('lists.show')
  router.post('/lists/:id', [controllers.lists.List, 'update']).as('lists.update')
  router.post('/lists/:id/archive', [controllers.lists.List, 'archive']).as('lists.archive')
  router.post('/lists/:id/delete', [controllers.lists.List, 'destroy']).as('lists.destroy')

  router.post('/lists/:listId/todos', [controllers.lists.Todo, 'store']).as('todos.store')
  router.post('/todos/:id', [controllers.lists.Todo, 'update']).as('todos.update')
  router.post('/todos/:id/complete', [controllers.lists.Todo, 'complete']).as('todos.complete')
  router.post('/todos/:id/delete', [controllers.lists.Todo, 'destroy']).as('todos.destroy')
  router.post('/todos/:id/move', [controllers.lists.Todo, 'move']).as('todos.move')
}

/**
 * The same resources over `/api/v1` (plan §11).
 */
export function registerListApiRoutes() {
  router.get('/lists', [controllers.lists.api.List, 'index']).as('api.lists.index')
  router.post('/lists', [controllers.lists.api.List, 'store']).as('api.lists.store')
  router.get('/lists/:id', [controllers.lists.api.List, 'show']).as('api.lists.show')
  router.patch('/lists/:id', [controllers.lists.api.List, 'update']).as('api.lists.update')
  router.delete('/lists/:id', [controllers.lists.api.List, 'destroy']).as('api.lists.destroy')

  router.get('/lists/:listId/todos', [controllers.lists.api.Todo, 'index']).as('api.todos.index')
  router.post('/lists/:listId/todos', [controllers.lists.api.Todo, 'store']).as('api.todos.store')

  router.get('/todos/:id', [controllers.lists.api.Todo, 'show']).as('api.todos.show')
  router.patch('/todos/:id', [controllers.lists.api.Todo, 'update']).as('api.todos.update')
  router
    .post('/todos/:id/complete', [controllers.lists.api.Todo, 'complete'])
    .as('api.todos.complete')
  router
    .post('/todos/:id/uncomplete', [controllers.lists.api.Todo, 'uncomplete'])
    .as('api.todos.uncomplete')
  router.delete('/todos/:id', [controllers.lists.api.Todo, 'destroy']).as('api.todos.destroy')
}
