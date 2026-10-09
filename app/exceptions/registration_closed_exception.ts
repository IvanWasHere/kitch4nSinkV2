import router from '@adonisjs/core/services/router'
import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * Somebody tried to create an account while public registration is closed
 * (plan §22.2).
 *
 * Handles itself, so the signup form, a hand-crafted POST and a first-time
 * social sign-in all end in the same place without each controller having to
 * remember to catch it.
 */
export default class RegistrationClosedException extends Exception {
  static status = 403
  static code = 'E_REGISTRATION_CLOSED'

  constructor() {
    super('New accounts are not being created right now.', {
      status: RegistrationClosedException.status,
      code: RegistrationClosedException.code,
    })
  }

  /**
   * The waiting list when a feature provides one, otherwise the signup page,
   * which explains that registration is closed. Found by route name so core
   * never names the feature that owns it.
   */
  static get destination(): string {
    return router.find('waitlist.create')
      ? router.makeUrl('waitlist.create')
      : router.makeUrl('auth.register.create')
  }

  async handle(error: this, ctx: HttpContext) {
    if (ctx.request.accepts(['html', 'json']) === 'json') {
      return ctx.response
        .status(403)
        .send({ error: { code: 'registration_closed', message: error.message } })
    }

    ctx.session.flash('error', error.message)
    return ctx.response.redirect().toPath(RegistrationClosedException.destination)
  }
}
