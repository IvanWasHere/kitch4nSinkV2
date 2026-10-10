/*
|--------------------------------------------------------------------------
| Privacy — routes (plan §22.8)
|--------------------------------------------------------------------------
|
| Called from inside the signed-in tenant group in `start/routes/web.ts`, so
| every route here inherits a verified session and a loaded organisation.
|
*/

import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

import { privacyDeletionThrottle, privacyExportThrottle } from '#modules/privacy/throttles'

export function registerPrivacyWebRoutes() {
  router.get('/settings/privacy', [controllers.privacy.Privacy, 'index']).as('settings.privacy')
  router
    .post('/settings/privacy/exports', [controllers.privacy.Privacy, 'requestExport'])
    .as('settings.privacy.exports.store')
    .use(privacyExportThrottle)
  router
    .get('/settings/privacy/exports/:id', [controllers.privacy.Privacy, 'download'])
    .as('settings.privacy.exports.download')
  router
    .post('/settings/privacy/deletion', [controllers.privacy.Privacy, 'requestDeletion'])
    .as('settings.privacy.deletion.store')
    .use(privacyDeletionThrottle)
  router
    .post('/settings/privacy/deletion/cancel', [controllers.privacy.Privacy, 'cancelDeletion'])
    .as('settings.privacy.deletion.cancel')
}

/**
 * The emailed confirmation link, for an account with no password. Called
 * inside the token group in `start/routes/auth.ts`: it has to work signed
 * out, and it is a token in a URL — the shape a script would walk.
 */
export function registerPrivacyTokenRoutes() {
  router
    .get('/privacy/deletion/confirm/:token', [controllers.privacy.Privacy, 'confirmDeletion'])
    .as('privacy.deletion.confirm')
}

/**
 * Back-office screens, inside the `/admin` group.
 */
export function registerPrivacyAdminRoutes() {
  router.get('/privacy', [controllers.privacy.AdminPrivacy, 'index']).as('admin.privacy.index')

  /**
   * Started by staff on somebody's behalf. Registered before `/privacy/:id`
   * reads more clearly, though the segment counts already keep them apart.
   */
  router
    .post('/privacy/exports', [controllers.privacy.AdminPrivacy, 'startExport'])
    .as('admin.privacy.exports.store')
  router
    .get('/privacy/deletions/new', [controllers.privacy.AdminPrivacy, 'newDeletion'])
    .as('admin.privacy.deletions.create')
  router
    .post('/privacy/deletions', [controllers.privacy.AdminPrivacy, 'startDeletion'])
    .as('admin.privacy.deletions.store')
  router
    .get('/privacy/:id/download', [controllers.privacy.AdminPrivacy, 'download'])
    .as('admin.privacy.download')

  router.get('/privacy/:id', [controllers.privacy.AdminPrivacy, 'show']).as('admin.privacy.show')
  router
    .post('/privacy/:id/retry', [controllers.privacy.AdminPrivacy, 'retry'])
    .as('admin.privacy.retry')
  router
    .post('/privacy/:id/approve', [controllers.privacy.AdminPrivacy, 'approve'])
    .as('admin.privacy.approve')
  router
    .post('/privacy/:id/reject', [controllers.privacy.AdminPrivacy, 'reject'])
    .as('admin.privacy.reject')
}
