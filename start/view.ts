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
import storage from '#storage/disk_storage'

/**
 * The product name, rendered in the logo, the <title> and transactional mail.
 */
edge.global('appName', env.get('APP_NAME', 'Acme'))

/**
 * Money, formatted at the edge and nowhere else.
 *
 * Amounts live as integer minor units everywhere else in the application
 * (portability rule 8); this is the one place they become a decimal, and it
 * is a template helper precisely so that no controller is tempted to hand a
 * view a pre-formatted string it cannot re-round.
 *
 * `whole` drops the fractional part, for a headline figure where the cents
 * are noise.
 */
edge.global('money', (cents: number, currency = 'USD', whole = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }).format((cents ?? 0) / 100)
)

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

/**
 * A URL for a public stored object — an avatar or a workspace logo (plan §10).
 *
 * Goes through `DiskStorage` rather than Drive's own `driveUrl` global so that
 * the rule holds everywhere: nothing outside `app/storage/` decides how an
 * object is addressed. Null in, null out, because a user without a picture is
 * the normal case and the avatar component falls back to initials.
 *
 * Only ever the **public** disk. A private object needs a signed URL with a
 * TTL, and a template is the wrong place to be choosing one.
 */
edge.global('publicFileUrl', async (key: string | null | undefined) => {
  if (!key) {
    return null
  }

  return storage.urlFor({ disk: 'public', key })
})
