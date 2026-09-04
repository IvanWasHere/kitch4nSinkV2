/*
|--------------------------------------------------------------------------
| Application routes
|--------------------------------------------------------------------------
|
| Everything behind a verified, signed-in tenant session. The middleware
| stack is the same for every route here, which is what makes it impossible
| to add a screen that forgets to scope itself to an organisation.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router.get('/dashboard', [controllers.Dashboard, 'index']).as('dashboard.index')

    router.get('/settings/profile', [controllers.settings.Profile, 'edit']).as('settings.profile')
    router
      .post('/settings/profile', [controllers.settings.Profile, 'update'])
      .as('settings.profile.update')

    router
      .get('/settings/security', [controllers.settings.Security, 'edit'])
      .as('settings.security')
    router
      .post('/settings/security/password', [controllers.settings.Security, 'updatePassword'])
      .as('settings.security.password')
    router
      .post('/settings/security/two-factor', [controllers.settings.Security, 'startTwoFactor'])
      .as('settings.security.two_factor.start')
    router
      .post('/settings/security/two-factor/confirm', [
        controllers.settings.Security,
        'confirmTwoFactor',
      ])
      .as('settings.security.two_factor.confirm')
    router
      .post('/settings/security/two-factor/recovery-codes', [
        controllers.settings.Security,
        'regenerateRecoveryCodes',
      ])
      .as('settings.security.two_factor.recovery_codes')
    router
      .post('/settings/security/two-factor/disable', [
        controllers.settings.Security,
        'disableTwoFactor',
      ])
      .as('settings.security.two_factor.disable')
  })
  .use([middleware.auth(), middleware.verifiedEmail(), middleware.organization()])
