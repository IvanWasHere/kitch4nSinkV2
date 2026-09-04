/*
|--------------------------------------------------------------------------
| View globals
|--------------------------------------------------------------------------
|
| Values and helpers shared with every Edge template.
|
*/

import edge from 'edge.js'
import env from '#start/env'
import router from '@adonisjs/core/services/router'

/**
 * The product name, rendered in the logo, the <title> and transactional mail.
 */
edge.global('appName', env.get('APP_NAME', 'Acme'))

/**
 * Whether a named route is registered.
 *
 * The application shell lists every destination it will eventually have, but
 * the milestones land one at a time (plan §17). Guarding each nav item on its
 * route means a section appears the moment its routes are registered, and no
 * template ever calls `urlFor()` on a route that does not exist yet.
 */
edge.global('hasRoute', (name: string) => router.find(name) !== null)
