import type { HttpContext } from '@adonisjs/core/http'

import registrationGate from '#auth/registration_gate'
import waitingList from '#modules/registration_control/services/waiting_list_service'
import { joinWaitingListValidator } from '#modules/registration_control/validators'

/**
 * The one sentence every submission gets back, whatever happened.
 */
const JOINED_MESSAGE =
  'If this email can be added to the waiting list, we will send further instructions.'

/**
 * The public waiting list (plan §22.5).
 *
 * Only offered while registration is closed: when anybody can sign up, the
 * list has nothing to wait for, so both routes send people to the signup
 * page instead.
 */
export default class WaitingListController {
  async create({ view, response }: HttpContext) {
    if (await registrationGate.isOpen()) {
      return response.redirect().toRoute('auth.register.create')
    }

    return view.render('pages/registration_control/waiting_list')
  }

  async store({ request, response, session }: HttpContext) {
    if (await registrationGate.isOpen()) {
      return response.redirect().toRoute('auth.register.create')
    }

    const { email } = await request.validateUsing(joinWaitingListValidator)

    await waitingList.join(email)

    session.flash('success', JOINED_MESSAGE)
    return response.redirect().toRoute('waitlist.create')
  }

  /**
   * Follow the link in the confirmation email. Works whatever the state of
   * registration — somebody who joined while it was closed can still confirm
   * after it opens — and in a browser that has never seen this site.
   */
  async confirm({ params, view }: HttpContext) {
    const outcome = await waitingList.confirm(params.token)

    return view.render('pages/registration_control/waiting_list_confirmation', { outcome })
  }
}
