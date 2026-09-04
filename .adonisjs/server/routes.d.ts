import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
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
    'settings.organization': { paramsTuple?: []; params?: {} }
    'settings.organization.update': { paramsTuple?: []; params?: {} }
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
    'admin.session.create': { paramsTuple?: []; params?: {} }
    'admin.session.store': { paramsTuple?: []; params?: {} }
    'admin.two_factor.create': { paramsTuple?: []; params?: {} }
    'admin.two_factor.store': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.session.destroy': { paramsTuple?: []; params?: {} }
    'admin.jobs.index': { paramsTuple?: []; params?: {} }
    'admin.jobs.retry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.jobs.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'home': { paramsTuple?: []; params?: {} }
    'styleguide': { paramsTuple?: []; params?: {} }
  }
  GET: {
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
    'members.index': { paramsTuple?: []; params?: {} }
    'settings.security': { paramsTuple?: []; params?: {} }
    'admin.session.create': { paramsTuple?: []; params?: {} }
    'admin.two_factor.create': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.jobs.index': { paramsTuple?: []; params?: {} }
    'home': { paramsTuple?: []; params?: {} }
    'styleguide': { paramsTuple?: []; params?: {} }
  }
  HEAD: {
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
    'members.index': { paramsTuple?: []; params?: {} }
    'settings.security': { paramsTuple?: []; params?: {} }
    'admin.session.create': { paramsTuple?: []; params?: {} }
    'admin.two_factor.create': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'admin.jobs.index': { paramsTuple?: []; params?: {} }
    'home': { paramsTuple?: []; params?: {} }
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
    'settings.organization.update': { paramsTuple?: []; params?: {} }
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
    'members.invite': { paramsTuple?: []; params?: {} }
    'members.remove': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invitations.revoke': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'invitations.resend': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'settings.security.password': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.start': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.confirm': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.recovery_codes': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.disable': { paramsTuple?: []; params?: {} }
    'admin.session.store': { paramsTuple?: []; params?: {} }
    'admin.two_factor.store': { paramsTuple?: []; params?: {} }
    'admin.session.destroy': { paramsTuple?: []; params?: {} }
    'admin.jobs.retry': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
    'admin.jobs.destroy': { paramsTuple: [ParamValue]; params: {'id': ParamValue} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}