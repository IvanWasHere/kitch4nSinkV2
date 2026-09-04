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
    'auth.verify_email.verify': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.session.destroy': { paramsTuple?: []; params?: {} }
    'auth.verify_email.notice': { paramsTuple?: []; params?: {} }
    'auth.verify_email.resend': { paramsTuple?: []; params?: {} }
    'dashboard.index': { paramsTuple?: []; params?: {} }
    'settings.profile': { paramsTuple?: []; params?: {} }
    'settings.profile.update': { paramsTuple?: []; params?: {} }
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
    'auth.verify_email.verify': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.verify_email.notice': { paramsTuple?: []; params?: {} }
    'dashboard.index': { paramsTuple?: []; params?: {} }
    'settings.profile': { paramsTuple?: []; params?: {} }
    'settings.security': { paramsTuple?: []; params?: {} }
    'admin.session.create': { paramsTuple?: []; params?: {} }
    'admin.two_factor.create': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
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
    'auth.verify_email.verify': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.verify_email.notice': { paramsTuple?: []; params?: {} }
    'dashboard.index': { paramsTuple?: []; params?: {} }
    'settings.profile': { paramsTuple?: []; params?: {} }
    'settings.security': { paramsTuple?: []; params?: {} }
    'admin.session.create': { paramsTuple?: []; params?: {} }
    'admin.two_factor.create': { paramsTuple?: []; params?: {} }
    'admin.dashboard': { paramsTuple?: []; params?: {} }
    'home': { paramsTuple?: []; params?: {} }
    'styleguide': { paramsTuple?: []; params?: {} }
  }
  POST: {
    'auth.register.store': { paramsTuple?: []; params?: {} }
    'auth.session.store': { paramsTuple?: []; params?: {} }
    'auth.password.store': { paramsTuple?: []; params?: {} }
    'auth.password.update': { paramsTuple: [ParamValue]; params: {'token': ParamValue} }
    'auth.two_factor.store': { paramsTuple?: []; params?: {} }
    'auth.session.destroy': { paramsTuple?: []; params?: {} }
    'auth.verify_email.resend': { paramsTuple?: []; params?: {} }
    'settings.profile.update': { paramsTuple?: []; params?: {} }
    'settings.security.password': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.start': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.confirm': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.recovery_codes': { paramsTuple?: []; params?: {} }
    'settings.security.two_factor.disable': { paramsTuple?: []; params?: {} }
    'admin.session.store': { paramsTuple?: []; params?: {} }
    'admin.two_factor.store': { paramsTuple?: []; params?: {} }
    'admin.session.destroy': { paramsTuple?: []; params?: {} }
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}