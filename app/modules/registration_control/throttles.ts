import limiter from '@adonisjs/limiter/services/main'

import { accountKey, addressKey } from '#start/limiter'

/**
 * Joining the waiting list, by address (plan §22.5).
 *
 * Each submission can send an email, so this is the same shape as signup's
 * limit: generous for a person, useless for a script.
 */
export const waitingListAddressThrottle = limiter.define('waiting_list_address', (ctx) => {
  return limiter
    .allowRequests(5)
    .every('1 hour')
    .usingKey(addressKey(ctx))
    .limitExceeded((error) => {
      error.setMessage('Too many requests from here. Try again later.')
    })
})

/**
 * Joining the waiting list, by the address being joined.
 *
 * The mailbox on the other end is what is being protected — somebody using
 * the form to send confirmation emails to a person who never asked. Three a
 * day is enough for "I never got it" twice.
 */
export const waitingListEmailThrottle = limiter.define('waiting_list_email', (ctx) => {
  return limiter
    .allowRequests(3)
    .every('1 day')
    .usingKey(accountKey(ctx.request.input('email')))
    .limitExceeded((error) => {
      error.setMessage('A confirmation email is already on its way. Check your inbox.')
    })
})
