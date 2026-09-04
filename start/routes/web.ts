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

    /**
     * Workspace settings and the team. Reading them is open to every member;
     * the owner-only actions are gated by policy inside the controllers, so
     * a member sees the screen without the buttons rather than a 403.
     */
    router
      .get('/settings/organization', [controllers.settings.Organization, 'edit'])
      .as('settings.organization')
    router
      .post('/settings/organization', [controllers.settings.Organization, 'update'])
      .as('settings.organization.update')
    router
      .post('/settings/organization/transfer', [controllers.organizations.Ownership, 'transfer'])
      .as('settings.organization.transfer')
    router
      .post('/settings/organization/delete', [controllers.settings.Organization, 'destroy'])
      .as('settings.organization.destroy')
    router
      .post('/settings/organization/leave', [controllers.organizations.Member, 'leave'])
      .as('settings.organization.leave')

    router.get('/members', [controllers.organizations.Member, 'index']).as('members.index')
    router
      .post('/members/invite', [controllers.organizations.Member, 'invite'])
      .as('members.invite')
    router
      .post('/members/:id/remove', [controllers.organizations.Member, 'remove'])
      .as('members.remove')
    router
      .post('/invitations/:id/revoke', [controllers.organizations.Invitation, 'revoke'])
      .as('invitations.revoke')
    router
      .post('/invitations/:id/resend', [controllers.organizations.Invitation, 'resend'])
      .as('invitations.resend')

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
