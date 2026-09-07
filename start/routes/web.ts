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
      .post('/settings/profile/avatar', [controllers.settings.Profile, 'updateAvatar'])
      .as('settings.profile.avatar')

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
      .post('/settings/organization/logo', [controllers.settings.Organization, 'updateLogo'])
      .as('settings.organization.logo')
    router
      .post('/settings/organization/transfer', [controllers.organizations.Ownership, 'transfer'])
      .as('settings.organization.transfer')
    router
      .post('/settings/organization/delete', [controllers.settings.Organization, 'destroy'])
      .as('settings.organization.destroy')
    router
      .post('/settings/organization/leave', [controllers.organizations.Member, 'leave'])
      .as('settings.organization.leave')

    /**
     * Lists and todos — the application itself (D8). Every route is scoped to
     * the organisation by the middleware stack above; nothing here accepts an
     * organisation id.
     */
    router.get('/lists', [controllers.todos.List, 'index']).as('lists.index')
    router.post('/lists', [controllers.todos.List, 'store']).as('lists.store')
    router.get('/lists/:id', [controllers.todos.List, 'show']).as('lists.show')
    router.post('/lists/:id', [controllers.todos.List, 'update']).as('lists.update')
    router.post('/lists/:id/archive', [controllers.todos.List, 'archive']).as('lists.archive')
    router.post('/lists/:id/delete', [controllers.todos.List, 'destroy']).as('lists.destroy')

    router.post('/lists/:listId/todos', [controllers.todos.Todo, 'store']).as('todos.store')
    router.post('/todos/:id', [controllers.todos.Todo, 'update']).as('todos.update')
    router.post('/todos/:id/complete', [controllers.todos.Todo, 'complete']).as('todos.complete')
    router.post('/todos/:id/delete', [controllers.todos.Todo, 'destroy']).as('todos.destroy')
    router.post('/todos/:id/move', [controllers.todos.Todo, 'move']).as('todos.move')

    /**
     * Files (plan §10). Uploading is open to every member; deleting is the
     * uploader's or the owner's, decided by `FilePolicy`.
     *
     * `show` redirects to a short-lived signed URL rather than streaming the
     * bytes, so a download does not go through our event loop.
     */
    router.get('/files', [controllers.files.File, 'index']).as('files.index')
    router.post('/files', [controllers.files.File, 'store']).as('files.store')
    router.get('/files/:id', [controllers.files.File, 'show']).as('files.show')
    router.post('/files/:id/delete', [controllers.files.File, 'destroy']).as('files.destroy')

    /**
     * Announcements (plan §20). Open to every member — there is nothing
     * owner-only about being told something — and what each person sees is
     * decided by the audience predicate rather than by a policy.
     */
    router
      .get('/notifications', [controllers.notifications.Notification, 'index'])
      .as('notifications.index')

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
