/*
|--------------------------------------------------------------------------
| Content — routes (plan §22.6)
|--------------------------------------------------------------------------
|
| Exported as functions and called from core's route files, like every other
| module's (docs/modules.md).
|
| `registerContentPageRoutes` must be called **last of all**: `/:slug`
| answers any single-segment path, and route order is what keeps it from
| answering one that belongs to somebody else. Its slug is also reserved
| against the live route table when it is saved, so the two defences do not
| depend on each other.
|
*/

import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

import { SLUG_PATTERN } from '#modules/content/services/slugs'

/**
 * Back-office screens, inside the `/admin` group.
 */
export function registerContentAdminRoutes() {
  const types = /^(posts|pages)$/

  router
    .get('/content/:type', [controllers.content.admin.Content, 'index'])
    .where('type', types)
    .as('admin.content.index')
  router
    .get('/content/:type/new', [controllers.content.admin.Content, 'create'])
    .where('type', types)
    .as('admin.content.create')
  router
    .post('/content/:type', [controllers.content.admin.Content, 'store'])
    .where('type', types)
    .as('admin.content.store')

  router
    .get('/content/entries/:id', [controllers.content.admin.Content, 'edit'])
    .as('admin.content.edit')
  router
    .post('/content/entries/:id', [controllers.content.admin.Content, 'update'])
    .as('admin.content.update')
  router
    .get('/content/entries/:id/preview', [controllers.content.admin.Content, 'preview'])
    .as('admin.content.preview')
  router
    .post('/content/entries/:id/publish', [controllers.content.admin.Content, 'publish'])
    .as('admin.content.publish')
  router
    .post('/content/entries/:id/unpublish', [controllers.content.admin.Content, 'unpublish'])
    .as('admin.content.unpublish')
  router
    .post('/content/entries/:id/archive', [controllers.content.admin.Content, 'archive'])
    .as('admin.content.archive')
  router
    .post('/content/entries/:id/delete', [controllers.content.admin.Content, 'destroy'])
    .as('admin.content.destroy')
}

/**
 * The public blog.
 */
export function registerContentPostRoutes() {
  router.get('/posts', [controllers.content.public.Post, 'index']).as('posts.index')
  router
    .get('/posts/:slug', [controllers.content.public.Post, 'show'])
    .where('slug', SLUG_PATTERN)
    .as('posts.show')
}

/**
 * Pages, at the root. Call this after every other route is registered.
 */
export function registerContentPageRoutes() {
  router
    .get('/:slug', [controllers.content.public.Page, 'show'])
    .where('slug', SLUG_PATTERN)
    .as('pages.show')
}
