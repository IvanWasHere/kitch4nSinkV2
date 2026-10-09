import router from '@adonisjs/core/services/router'
import type { HttpContext } from '@adonisjs/core/http'

import registrationGate from '#auth/registration_gate'
import { plans } from '#config/plans'

/**
 * The public front of the product (plan §22.7): the marketing page and the
 * code-defined legal pages.
 *
 * Asks core whether registration is open — never the Registration Control
 * module itself — so either module can be removed without the other
 * noticing (plan §22.4).
 */
export default class LandingController {
  async home({ view, auth }: HttpContext) {
    const registrationOpen = await registrationGate.isOpen()

    return view.render('pages/landing/home', {
      signedIn: auth.use('web').isAuthenticated,
      registrationOpen,
      waitingList: !registrationOpen && router.find('waitlist.create') !== null,

      /**
       * The real tiers from `config/plans.ts`, so the landing page cannot
       * advertise a limit the product does not enforce. The middle tier is
       * the one drawn as the recommendation.
       */
      plans: Object.entries(plans).map(([key, plan], index, all) => ({
        key,
        plan,
        featured: all.length > 2 ? index === 1 : false,
      })),
    })
  }

  async privacy({ view }: HttpContext) {
    return view.render('pages/landing/privacy')
  }

  async terms({ view }: HttpContext) {
    return view.render('pages/landing/terms')
  }
}
