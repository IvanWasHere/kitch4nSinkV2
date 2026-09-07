import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'drive.private.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'drive.public.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'auth.register.create': { paramsTuple?: []; params?: {} }
    'auth.register.store': { paramsTuple?: []; params?: {} }
    'auth.session.create': { paramsTuple?: []; params?: {} }
    'auth.session.store': { paramsTuple?: []; params?: {} }
    'auth.password.create': { paramsTuple?: []; params?: {} }
    'auth.password.store': { paramsTuple?: []; params?: {} }
    'auth.password.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.password.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.two_factor.create': { paramsTuple?: []; params?: {} }
    'auth.two_factor.store': { paramsTuple?: []; params?: {} }
    'auth.social.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'auth.social.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'invitations.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invitations.form': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invitations.accept': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.verify_email.verify': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.session.destroy': { paramsTuple?: []; params?: {} }
    'auth.verify_email.notice': { paramsTuple?: []; params?: {} }
    'auth.verify_email.resend': { paramsTuple?: []; params?: {} }
    'dashboard.index': { paramsTuple?: []; params?: {} }
    'settings.profile': { paramsTuple?: []; params?: {} }
    'settings.profile.update': { paramsTuple?: []; params?: {} }
    'settings.profile.avatar': { paramsTuple?: []; params?: {} }
    'settings.organization': { paramsTuple?: []; params?: {} }
    'settings.organization.update': { paramsTuple?: []; params?: {} }
    'settings.organization.logo': { paramsTuple?: []; params?: {} }
    'settings.organization.transfer': { paramsTuple?: []; params?: {} }
    'settings.organization.destroy': { paramsTuple?: []; params?: {} }
    'settings.organization.leave': { paramsTuple?: []; params?: {} }
    'lists.index': { paramsTuple?: []; params?: {} }
    'lists.store': { paramsTuple?: []; params?: {} }
    'lists.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lists.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lists.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lists.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'todos.store': { paramsTuple: [ParamValue]; params: {'listId': ParamValue} }
    'todos.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'todos.complete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'todos.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'todos.move': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'files.index': { paramsTuple?: []; params?: {} }
    'files.store': { paramsTuple?: []; params?: {} }
    'files.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'files.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'members.index': { paramsTuple?: []; params?: {} }
    'members.invite': { paramsTuple?: []; params?: {} }
    'members.remove': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invitations.revoke': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invitations.resend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'settings.security': { paramsTuple?: []; params?: {} }
    'settings.security.password': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.start': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.confirm': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.recovery_codes': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.disable': { paramsTuple?: []; params?: {} }
    'billing.index': { paramsTuple?: []; params?: {} }
    'billing.checkout': { paramsTuple?: []; params?: {} }
    'billing.return': { paramsTuple?: []; params?: {} }
    'billing.status': { paramsTuple?: []; params?: {} }
    'billing.portal': { paramsTuple?: []; params?: {} }
    'api_keys.index': { paramsTuple?: []; params?: {} }
    'api_keys.store': { paramsTuple?: []; params?: {} }
    'api_keys.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'webhooks.creem': { paramsTuple?: []; params?: {} }
    'api.organization.show': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple?: []; params?: {} }
    'api.lists.index': { paramsTuple?: []; params?: {} }
    'api.lists.store': { paramsTuple?: []; params?: {} }
    'api.lists.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.lists.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.lists.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.index': { paramsTuple: [ParamValue]; params: {'listId': ParamValue} }
    'api.todos.store': { paramsTuple: [ParamValue]; params: {'listId': ParamValue} }
    'api.todos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.complete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.uncomplete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.session.create': { paramsTuple?: []; params?: {} }
    'admin.session.store': { paramsTuple?: []; params?: {} }
    'admin.two_factor.create': { paramsTuple?: []; params?: {} }
    'admin.two_factor.store': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.session.destroy': { paramsTuple?: []; params?: {} }
    'admin.jobs.index': { paramsTuple?: []; params?: {} }
    'admin.jobs.retry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.jobs.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organizations.index': { paramsTuple?: []; params?: {} }
    'admin.organizations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organizations.suspend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organizations.plan': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organizations.limits': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.users.index': { paramsTuple?: []; params?: {} }
    'admin.users.resend_verification': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.users.verify': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.users.reset_two_factor': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.impersonation.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.subscriptions.index': { paramsTuple?: []; params?: {} }
    'admin.subscriptions.reconciliation': { paramsTuple?: []; params?: {} }
    'admin.subscriptions.sync': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.subscriptions.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.webhooks.index': { paramsTuple?: []; params?: {} }
    'admin.webhooks.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.webhooks.replay': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.notifications.index': { paramsTuple?: []; params?: {} }
    'admin.notifications.store': { paramsTuple?: []; params?: {} }
    'admin.notifications.publish': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.notifications.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.audit_logs.index': { paramsTuple?: []; params?: {} }
    'admin.staff.index': { paramsTuple?: []; params?: {} }
    'admin.staff.store': { paramsTuple?: []; params?: {} }
    'admin.staff.toggle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'impersonation.destroy': { paramsTuple?: []; params?: {} }
    'home': { paramsTuple?: []; params?: {} }
    'docs.index': { paramsTuple?: []; params?: {} }
    'docs.openapi': { paramsTuple?: []; params?: {} }
    'styleguide': { paramsTuple?: []; params?: {} }
  }
  GET: {
    'drive.private.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'drive.public.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'auth.register.create': { paramsTuple?: []; params?: {} }
    'auth.session.create': { paramsTuple?: []; params?: {} }
    'auth.password.create': { paramsTuple?: []; params?: {} }
    'auth.password.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.two_factor.create': { paramsTuple?: []; params?: {} }
    'auth.social.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'auth.social.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'invitations.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invitations.form': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.verify_email.verify': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.verify_email.notice': { paramsTuple?: []; params?: {} }
    'dashboard.index': { paramsTuple?: []; params?: {} }
    'settings.profile': { paramsTuple?: []; params?: {} }
    'settings.organization': { paramsTuple?: []; params?: {} }
    'lists.index': { paramsTuple?: []; params?: {} }
    'lists.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'files.index': { paramsTuple?: []; params?: {} }
    'files.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'members.index': { paramsTuple?: []; params?: {} }
    'settings.security': { paramsTuple?: []; params?: {} }
    'billing.index': { paramsTuple?: []; params?: {} }
    'billing.return': { paramsTuple?: []; params?: {} }
    'billing.status': { paramsTuple?: []; params?: {} }
    'api_keys.index': { paramsTuple?: []; params?: {} }
    'api.organization.show': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple?: []; params?: {} }
    'api.lists.index': { paramsTuple?: []; params?: {} }
    'api.lists.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.index': { paramsTuple: [ParamValue]; params: {'listId': ParamValue} }
    'api.todos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.session.create': { paramsTuple?: []; params?: {} }
    'admin.two_factor.create': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.jobs.index': { paramsTuple?: []; params?: {} }
    'admin.organizations.index': { paramsTuple?: []; params?: {} }
    'admin.organizations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.users.index': { paramsTuple?: []; params?: {} }
    'admin.subscriptions.index': { paramsTuple?: []; params?: {} }
    'admin.subscriptions.reconciliation': { paramsTuple?: []; params?: {} }
    'admin.webhooks.index': { paramsTuple?: []; params?: {} }
    'admin.webhooks.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.notifications.index': { paramsTuple?: []; params?: {} }
    'admin.audit_logs.index': { paramsTuple?: []; params?: {} }
    'admin.staff.index': { paramsTuple?: []; params?: {} }
    'home': { paramsTuple?: []; params?: {} }
    'docs.index': { paramsTuple?: []; params?: {} }
    'docs.openapi': { paramsTuple?: []; params?: {} }
    'styleguide': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
    'drive.private.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'drive.public.serve': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
    'auth.register.create': { paramsTuple?: []; params?: {} }
    'auth.session.create': { paramsTuple?: []; params?: {} }
    'auth.password.create': { paramsTuple?: []; params?: {} }
    'auth.password.edit': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.two_factor.create': { paramsTuple?: []; params?: {} }
    'auth.social.redirect': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'auth.social.callback': { paramsTuple: [ParamValue]; params: {'provider': ParamValue} }
    'invitations.show': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'invitations.form': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.verify_email.verify': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.verify_email.notice': { paramsTuple?: []; params?: {} }
    'dashboard.index': { paramsTuple?: []; params?: {} }
    'settings.profile': { paramsTuple?: []; params?: {} }
    'settings.organization': { paramsTuple?: []; params?: {} }
    'lists.index': { paramsTuple?: []; params?: {} }
    'lists.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'files.index': { paramsTuple?: []; params?: {} }
    'files.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'notifications.index': { paramsTuple?: []; params?: {} }
    'members.index': { paramsTuple?: []; params?: {} }
    'settings.security': { paramsTuple?: []; params?: {} }
    'billing.index': { paramsTuple?: []; params?: {} }
    'billing.return': { paramsTuple?: []; params?: {} }
    'billing.status': { paramsTuple?: []; params?: {} }
    'api_keys.index': { paramsTuple?: []; params?: {} }
    'api.organization.show': { paramsTuple?: []; params?: {} }
    'api.members.index': { paramsTuple?: []; params?: {} }
    'api.lists.index': { paramsTuple?: []; params?: {} }
    'api.lists.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.index': { paramsTuple: [ParamValue]; params: {'listId': ParamValue} }
    'api.todos.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.session.create': { paramsTuple?: []; params?: {} }
    'admin.two_factor.create': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.jobs.index': { paramsTuple?: []; params?: {} }
    'admin.organizations.index': { paramsTuple?: []; params?: {} }
    'admin.organizations.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.users.index': { paramsTuple?: []; params?: {} }
    'admin.subscriptions.index': { paramsTuple?: []; params?: {} }
    'admin.subscriptions.reconciliation': { paramsTuple?: []; params?: {} }
    'admin.webhooks.index': { paramsTuple?: []; params?: {} }
    'admin.webhooks.show': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.notifications.index': { paramsTuple?: []; params?: {} }
    'admin.audit_logs.index': { paramsTuple?: []; params?: {} }
    'admin.staff.index': { paramsTuple?: []; params?: {} }
    'home': { paramsTuple?: []; params?: {} }
    'docs.index': { paramsTuple?: []; params?: {} }
    'docs.openapi': { paramsTuple?: []; params?: {} }
    'styleguide': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'auth.register.store': { paramsTuple?: []; params?: {} }
    'auth.session.store': { paramsTuple?: []; params?: {} }
    'auth.password.store': { paramsTuple?: []; params?: {} }
    'auth.password.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.two_factor.store': { paramsTuple?: []; params?: {} }
    'invitations.accept': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.session.destroy': { paramsTuple?: []; params?: {} }
    'auth.verify_email.resend': { paramsTuple?: []; params?: {} }
    'settings.profile.update': { paramsTuple?: []; params?: {} }
    'settings.profile.avatar': { paramsTuple?: []; params?: {} }
    'settings.organization.update': { paramsTuple?: []; params?: {} }
    'settings.organization.logo': { paramsTuple?: []; params?: {} }
    'settings.organization.transfer': { paramsTuple?: []; params?: {} }
    'settings.organization.destroy': { paramsTuple?: []; params?: {} }
    'settings.organization.leave': { paramsTuple?: []; params?: {} }
    'lists.store': { paramsTuple?: []; params?: {} }
    'lists.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lists.archive': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'lists.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'todos.store': { paramsTuple: [ParamValue]; params: {'listId': ParamValue} }
    'todos.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'todos.complete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'todos.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'todos.move': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'files.store': { paramsTuple?: []; params?: {} }
    'files.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'members.invite': { paramsTuple?: []; params?: {} }
    'members.remove': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invitations.revoke': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invitations.resend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'settings.security.password': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.start': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.confirm': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.recovery_codes': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.disable': { paramsTuple?: []; params?: {} }
    'billing.checkout': { paramsTuple?: []; params?: {} }
    'billing.portal': { paramsTuple?: []; params?: {} }
    'api_keys.store': { paramsTuple?: []; params?: {} }
    'api_keys.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'webhooks.creem': { paramsTuple?: []; params?: {} }
    'api.lists.store': { paramsTuple?: []; params?: {} }
    'api.todos.store': { paramsTuple: [ParamValue]; params: {'listId': ParamValue} }
    'api.todos.complete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.uncomplete': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.session.store': { paramsTuple?: []; params?: {} }
    'admin.two_factor.store': { paramsTuple?: []; params?: {} }
    'admin.session.destroy': { paramsTuple?: []; params?: {} }
    'admin.jobs.retry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.jobs.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organizations.suspend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organizations.plan': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.organizations.limits': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.users.resend_verification': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.users.verify': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.users.reset_two_factor': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.impersonation.store': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.subscriptions.sync': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.subscriptions.cancel': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.webhooks.replay': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.notifications.store': { paramsTuple?: []; params?: {} }
    'admin.notifications.publish': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.notifications.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.staff.store': { paramsTuple?: []; params?: {} }
    'admin.staff.toggle': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'impersonation.destroy': { paramsTuple?: []; params?: {} }
  }
  PATCH: {
    'api.lists.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.update': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
  DELETE: {
    'api.lists.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'api.todos.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}