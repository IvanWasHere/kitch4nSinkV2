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

import '#start/routes/auth'
import '#start/routes/web'
import '#start/routes/admin'

router.on('/').render('pages/home').as('home')

/**
 * The component library, rendered against the design tokens. Development only
 * — it is a review surface, not a page anyone should reach in production.
 */
if (app.inDev) {
  router.on('/styleguide').render('pages/dev/styleguide').as('styleguide')
}
