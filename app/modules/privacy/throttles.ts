import limiter from '@adonisjs/limiter/services/main'

/**
 * Asking for an export, by account (plan §22.8.1). Each one zips a whole
 * account's data and files, so three a day is plenty for a person and keeps a
 * script from turning the worker into a compression farm.
 */
export const privacyExportThrottle = limiter.define('privacy_export', (ctx) => {
  return limiter
    .allowRequests(3)
    .every('1 day')
    .usingKey(`user:${ctx.auth.user?.id ?? ctx.request.ip()}`)
    .limitExceeded((error) => {
      error.setMessage('You have asked for several exports today. Try again tomorrow.')
    })
})

/**
 * Asking to be deleted, by account. Each one may send a confirmation email,
 * and a person needs this once.
 */
export const privacyDeletionThrottle = limiter.define('privacy_deletion', (ctx) => {
  return limiter
    .allowRequests(5)
    .every('1 day')
    .usingKey(`user:${ctx.auth.user?.id ?? ctx.request.ip()}`)
    .limitExceeded((error) => {
      error.setMessage('Too many deletion requests today. Try again tomorrow.')
    })
})
