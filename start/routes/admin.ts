/*
|--------------------------------------------------------------------------
| Back-office routes
|--------------------------------------------------------------------------
|
| Mounted at /admin, behind the staff guard and its own login (D5).
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router.get('/login', [controllers.admin.Session, 'create']).as('admin.session.create')
    router.post('/login', [controllers.admin.Session, 'store']).as('admin.session.store')

    router
      .get('/two-factor', [controllers.auth.TwoFactorChallenge, 'create'])
      .as('admin.two_factor.create')
    router
      .post('/two-factor', [controllers.auth.TwoFactorChallenge, 'store'])
      .as('admin.two_factor.store')
  })
  .prefix('/admin')
  .use(middleware.staffGuest())

router
  .group(() => {
    router.get('/', [controllers.admin.Dashboard, 'index']).as('admin.dashboard')
    router.post('/logout', [controllers.admin.Session, 'destroy']).as('admin.session.destroy')

    router.get('/jobs', [controllers.admin.Job, 'index']).as('admin.jobs.index')
    router.post('/jobs/:id/retry', [controllers.admin.Job, 'retry']).as('admin.jobs.retry')
    router.post('/jobs/:id/discard', [controllers.admin.Job, 'destroy']).as('admin.jobs.destroy')
  })
  .prefix('/admin')
  .use(middleware.staffAuth())
