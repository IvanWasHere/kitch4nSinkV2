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

import plans from '#billing/plan_service'

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

/**
 * Entitlement checks in a template (plan §7.3).
 *
 * `can('api')` and `withinLimit('lists')` read the same `PlanService` a
 * controller does, so the upsell UI and server-side enforcement can never
 * disagree about what a plan allows. Globals rather than the tags plan §7.3
 * sketched, because a tag cannot be used inside an expression — both
 * `@if(can('api'))` and `class="{{ withinLimit('lists') ? '' : 'disabled' }}"`
 * are needed, and only a global does the second.
 *
 * Both are pure functions over `organization.planKey`: no database read, so
 * calling one per row in a loop costs nothing.
 */
edge.global('can', function (this: any, feature: string) {
  const organization = this?.organization ?? this?.state?.organization

  return organization ? plans.can(organization, feature) : false
})

/**
 * Whether the organisation is *below* a limit — i.e. whether one more would
 * fit. Renders the disabled state on an at-cap button before it is clicked,
 * which is the difference between a ceiling you can see and one you discover
 * by losing your work to a redirect (plan §7.4).
 *
 * Usage comes from what the controller shared, because counting here would be
 * a second calculation of a number enforcement already owns.
 */
edge.global('withinLimit', function (this: any, limit: 'lists' | 'seats') {
  const usage = this?.usage ?? this?.state?.usage

  return usage?.[limit] ? !usage[limit].isFull : true
})
