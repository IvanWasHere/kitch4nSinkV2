/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| Routes are registered per area. As milestones land, each area moves into
| its own file under start/routes/ (plan §4).
|
*/

import app from '@adonisjs/core/services/app'
import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router.on('/').render('pages/home').as('home')

/**
 * The component library, rendered against the design tokens. Development only
 * — it is a review surface, not a page anyone should reach in production.
 */
if (app.inDev) {
  router.on('/styleguide').render('pages/dev/styleguide').as('styleguide')
}

router
  .group(() => {
    router.get('signup', [controllers.NewAccount, 'create'])
    router.post('signup', [controllers.NewAccount, 'store'])

    router.get('login', [controllers.Session, 'create'])
    router.post('login', [controllers.Session, 'store'])
  })
  .use(middleware.guest())

router
  .group(() => {
    router.post('logout', [controllers.Session, 'destroy'])
  })
  .use(middleware.auth())
