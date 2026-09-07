import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'

import billing, { BillingError } from '#billing/billing_service'
import { plans as planCatalogue, type PlanKey } from '#config/plans'

/**
 * The billing screen and the two redirects that leave for the provider
 * (plan §7.5).
 *
 * Owner-only, gated by the route group's middleware rather than by a check in
 * every method — a member never reaches the screen at all (plan §6).
 */
export default class BillingController {
  async index({ view, organization }: HttpContext) {
    const overview = await billing.overview(organization)

    return view.render('pages/billing/index', overview)
  }

  /**
   * Start a checkout and hand the customer to Creem.
   *
   * Nothing about the organisation changes here. Entitlements move when the
   * webhook says money moved, and not one step earlier (plan §7.5).
   */
  async checkout({ request, response, session, auth, organization }: HttpContext) {
    const planKey = String(request.input('plan', ''))

    if (!(planKey in planCatalogue)) {
      session.flash('error', 'That plan does not exist.')
      return response.redirect().toRoute('billing.index')
    }

    try {
      const { url } = await billing.startCheckout(
        organization,
        auth.use('web').user!,
        planKey as PlanKey
      )

      /**
       * An external redirect, so `toPath` rather than a named route — and
       * `clearQs()`, because `config/app.ts` forwards the request's query
       * string onto every redirect and appending it to a provider's checkout
       * URL would change the link they built.
       */
      return response.redirect().clearQs().toPath(url)
    } catch (error) {
      if (error instanceof BillingError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('billing.index')
      }

      /**
       * The provider was unreachable or refused. Logged in full and shown as
       * a plain failure: nothing was charged, and a stack trace is not what
       * somebody with their card out needs to read.
       */
      logger.error({ err: error, organizationId: organization.id, planKey }, 'checkout failed')

      session.flash(
        'error',
        'We could not reach our payment provider just now. Nothing was charged — please try again.'
      )
      return response.redirect().toRoute('billing.index')
    }
  }

  /**
   * Where Creem sends the customer back to.
   *
   * **Optimistic UI only.** It grants nothing: a user can type this URL, so
   * it renders "activating your subscription…" and polls until the webhook
   * has actually landed (plan §7.5).
   */
  async return({ view, organization }: HttpContext) {
    const subscription = await billing.activeSubscription(organization)

    return view.render('pages/billing/return', {
      subscription,
      isActive: Boolean(subscription?.isEntitling),
    })
  }

  /**
   * Answers the poll from the return screen. Deliberately tiny — it is hit
   * every couple of seconds while a customer waits.
   */
  async status({ response, organization }: HttpContext) {
    const subscription = await billing.activeSubscription(organization)

    return response.send({
      active: Boolean(subscription?.isEntitling),
      status: subscription?.status ?? null,
      planKey: organization.planKey,
    })
  }

  /**
   * Send the owner to the provider's portal to change a card, download an
   * invoice or cancel. Card details never touch this application.
   */
  async portal({ response, session, organization }: HttpContext) {
    try {
      const { url } = await billing.startPortal(organization)

      /**
       * `clearQs()` for the same reason as checkout: never append our query
       * string to a URL somebody else built.
       */
      return response.redirect().clearQs().toPath(url)
    } catch (error) {
      if (error instanceof BillingError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('billing.index')
      }

      logger.error({ err: error, organizationId: organization.id }, 'billing portal failed')

      session.flash('error', 'We could not open the billing portal just now. Please try again.')
      return response.redirect().toRoute('billing.index')
    }
  }
}
