/*
|--------------------------------------------------------------------------
| Back-office routes
|--------------------------------------------------------------------------
|
| Mounted at /admin, behind the staff guard and its own login (D5).
|
| `adminIpAllowlist` wraps **both** groups, including the login page: when
| `ADMIN_IP_ALLOWLIST` is set, the whole back-office stops existing for
| anybody else (plan §12). It is a second layer, never the boundary — the
| staff guard and mandatory two-factor are.
|
| Support can reach every screen here; the actions that move money, remove
| access or change entitlements are admin-only, decided by `StaffPolicy`
| inside each controller so a support agent sees a screen without its
| dangerous buttons rather than a 403.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router.get('/login', [controllers.admin.Session, 'create']).as('admin.session.create')
    router.post('/login', [controllers.admin.Session, 'store']).as('admin.session.store')

    router
      .get('/two-factor', [controllers.auth.TwoFactorChallenge, 'create'])
      .as('admin.two_factor.create')
    router
      .post('/two-factor', [controllers.auth.TwoFactorChallenge, 'store'])
      .as('admin.two_factor.store')
  })
  .prefix('/admin')
  .use([middleware.adminIpAllowlist(), middleware.staffGuest()])

router
  .group(() => {
    router.get('/', [controllers.admin.Dashboard, 'index']).as('admin.dashboard')
    router.post('/logout', [controllers.admin.Session, 'destroy']).as('admin.session.destroy')

    router.get('/jobs', [controllers.admin.Job, 'index']).as('admin.jobs.index')
    router.post('/jobs/:id/retry', [controllers.admin.Job, 'retry']).as('admin.jobs.retry')
    router.post('/jobs/:id/discard', [controllers.admin.Job, 'destroy']).as('admin.jobs.destroy')

    /**
     * Organisations — the screen a ticket starts on.
     */
    router
      .get('/organizations', [controllers.admin.Organization, 'index'])
      .as('admin.organizations.index')
    router
      .get('/organizations/:id', [controllers.admin.Organization, 'show'])
      .as('admin.organizations.show')
    router
      .post('/organizations/:id/suspend', [controllers.admin.Organization, 'suspend'])
      .as('admin.organizations.suspend')
    router
      .post('/organizations/:id/plan', [controllers.admin.Organization, 'overridePlan'])
      .as('admin.organizations.plan')
    router
      .post('/organizations/:id/limits', [controllers.admin.Organization, 'overrideLimits'])
      .as('admin.organizations.limits')

    /**
     * Users — resend verification, confirm by hand, clear a lost second
     * factor. All reversible, all support-level.
     */
    router.get('/users', [controllers.admin.User, 'index']).as('admin.users.index')
    router
      .post('/users/:id/resend-verification', [controllers.admin.User, 'resendVerification'])
      .as('admin.users.resend_verification')
    router.post('/users/:id/verify', [controllers.admin.User, 'verify']).as('admin.users.verify')
    router
      .post('/users/:id/reset-two-factor', [controllers.admin.User, 'resetTwoFactor'])
      .as('admin.users.reset_two_factor')

    /**
     * Impersonation (plan §6). Starting it is here; ending it is a tenant
     * route, because the banner that ends it renders on tenant screens.
     */
    router
      .post('/users/:id/impersonate', [controllers.admin.Impersonation, 'store'])
      .as('admin.impersonation.store')

    router
      .get('/subscriptions', [controllers.admin.Subscription, 'index'])
      .as('admin.subscriptions.index')
    router
      .get('/subscriptions/reconciliation', [controllers.admin.Subscription, 'reconcile'])
      .as('admin.subscriptions.reconciliation')
    router
      .post('/subscriptions/:id/sync', [controllers.admin.Subscription, 'sync'])
      .as('admin.subscriptions.sync')
    router
      .post('/subscriptions/:id/cancel', [controllers.admin.Subscription, 'cancel'])
      .as('admin.subscriptions.cancel')

    router.get('/webhooks', [controllers.admin.Webhook, 'index']).as('admin.webhooks.index')
    router.get('/webhooks/:id', [controllers.admin.Webhook, 'show']).as('admin.webhooks.show')
    router
      .post('/webhooks/:id/replay', [controllers.admin.Webhook, 'replay'])
      .as('admin.webhooks.replay')

    /**
     * Announcements (plan §20). Support can read the list; only an admin may
     * write one, decided by `StaffPolicy` inside the controller.
     */
    router
      .get('/notifications', [controllers.admin.Notification, 'index'])
      .as('admin.notifications.index')
    router
      .post('/notifications', [controllers.admin.Notification, 'store'])
      .as('admin.notifications.store')
    router
      .post('/notifications/:id/publish', [controllers.admin.Notification, 'publish'])
      .as('admin.notifications.publish')
    router
      .post('/notifications/:id/delete', [controllers.admin.Notification, 'destroy'])
      .as('admin.notifications.destroy')

    router.get('/audit', [controllers.admin.AuditLog, 'index']).as('admin.audit_logs.index')

    router.get('/staff', [controllers.admin.Staff, 'index']).as('admin.staff.index')
    router.post('/staff', [controllers.admin.Staff, 'store']).as('admin.staff.store')
    router.post('/staff/:id/toggle', [controllers.admin.Staff, 'toggle']).as('admin.staff.toggle')
  })
  .prefix('/admin')
  .use([middleware.adminIpAllowlist(), middleware.staffAuth()])

/**
 * Ending an impersonation lives outside the admin group on purpose: it is
 * reached from the banner on a **tenant** screen, where the staff guard's
 * redirect would send somebody to the admin login instead of just stopping.
 */
router
  .post('/stop-impersonating', [controllers.admin.Impersonation, 'destroy'])
  .as('impersonation.destroy')
