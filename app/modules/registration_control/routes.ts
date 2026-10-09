/*
|--------------------------------------------------------------------------
| Registration Control — routes (plan §22.5)
|--------------------------------------------------------------------------
|
| Exported as functions and called from inside core's groups, like the demo
| domain's (docs/modules.md): the back-office group carries the staff guard,
| mandatory two-factor and the IP allowlist, and a module registering its own
| group could forget one of them.
|
*/

import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'
import {
  waitingListAddressThrottle,
  waitingListEmailThrottle,
} from '#modules/registration_control/throttles'

/**
 * The waiting-list form. Called inside the signed-out group in
 * `start/routes/auth.ts`, so it inherits the guest guard and the address
 * limit on the whole signed-out surface; somebody signed in already has an
 * account.
 */
export function registerWaitingListGuestRoutes() {
  router
    .get('/waitlist', [controllers.registrationControl.WaitingList, 'create'])
    .as('waitlist.create')
  router
    .post('/waitlist', [controllers.registrationControl.WaitingList, 'store'])
    .as('waitlist.store')
    .use([waitingListAddressThrottle, waitingListEmailThrottle])
}

/**
 * The confirmation link. Called inside the token group in
 * `start/routes/auth.ts`: it has to work in a browser that has never seen
 * this site, signed in or not, and it is a token in a URL — the shape a
 * script would walk.
 */
export function registerWaitingListTokenRoutes() {
  router
    .get('/waitlist/confirm/:token', [controllers.registrationControl.WaitingList, 'confirm'])
    .as('waitlist.confirm')
}

/**
 * Back-office screens. Called inside the `/admin` group, so paths here are
 * relative to it.
 */
export function registerRegistrationAdminRoutes() {
  router
    .get('/settings/registration', [controllers.registrationControl.RegistrationSettings, 'edit'])
    .as('admin.settings.registration')
  router
    .post('/settings/registration', [
      controllers.registrationControl.RegistrationSettings,
      'update',
    ])
    .as('admin.settings.registration.update')

  router
    .get('/waitlist', [controllers.registrationControl.WaitingListAdmin, 'index'])
    .as('admin.waitlist.index')
  router
    .post('/waitlist/:id/cancel', [controllers.registrationControl.WaitingListAdmin, 'cancel'])
    .as('admin.waitlist.cancel')
  router
    .post('/waitlist/:id/convert', [controllers.registrationControl.WaitingListAdmin, 'convert'])
    .as('admin.waitlist.convert')
  router
    .post('/waitlist/:id/resend', [controllers.registrationControl.WaitingListAdmin, 'resend'])
    .as('admin.waitlist.resend')
  router
    .post('/waitlist/:id/delete', [controllers.registrationControl.WaitingListAdmin, 'destroy'])
    .as('admin.waitlist.destroy')
}
