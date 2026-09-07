/*
|--------------------------------------------------------------------------
| Billing routes
|--------------------------------------------------------------------------
|
| Two groups with nothing in common but a prefix.
|
| The screens are owner-only and behind the full session stack: billing is
| the one area where a member should not even see the page, so the coarse
| gate is middleware rather than a policy on each action (plan §6).
|
| The webhook has no session at all. Its authentication is the signature over
| the raw body, and it is CSRF-exempt in `config/shield.ts` for the same
| reason — there is no browser on the other end of it.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router.get('/billing', [controllers.billing.Billing, 'index']).as('billing.index')
    router
      .post('/billing/checkout', [controllers.billing.Billing, 'checkout'])
      .as('billing.checkout')

    /**
     * Optimistic UI only. It grants nothing — the webhook is the source of
     * truth — so it renders a waiting state and polls `billing.status`
     * (plan §7.5).
     */
    router.get('/billing/return', [controllers.billing.Billing, 'return']).as('billing.return')
    router.get('/billing/status', [controllers.billing.Billing, 'status']).as('billing.status')

    router.post('/billing/portal', [controllers.billing.Billing, 'portal']).as('billing.portal')
  })
  .use([
    middleware.auth(),
    middleware.verifiedEmail(),
    middleware.organization(),
    middleware.owner(),
  ])

/**
 * No middleware. Adding `auth` here would 401 every delivery.
 */
router.post('/webhooks/creem', [controllers.billing.Webhook, 'creem']).as('webhooks.creem')
