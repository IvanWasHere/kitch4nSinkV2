import type { HttpContext } from '@adonisjs/core/http'

import settings from '#settings/settings_service'
import { registrationSettingsValidator } from '#modules/registration_control/validators'

/**
 * Admin → Settings → Registration (plan §22.5).
 *
 * Admin only, through `StaffPolicy.manageSettings`: closing registration
 * turns away every new customer, which is the same blast radius as the other
 * admin-only actions.
 */
export default class RegistrationSettingsController {
  async edit({ view, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('manageSettings')

    return view.render('pages/registration_control/settings', {
      registrationEnabled: await settings.get('registration_enabled'),
      waitingListDoubleOptIn: await settings.get('waiting_list_double_opt_in'),
    })
  }

  /**
   * Only the settings whose value actually changed are written, so saving the
   * form without touching it leaves no audit entries behind — the trail
   * should answer "who closed registration?", not "who pressed Save?".
   */
  async update(ctx: HttpContext) {
    const { request, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('manageSettings')

    const payload = await request.validateUsing(registrationSettingsValidator)

    const submitted = {
      registration_enabled: payload.registrationEnabled ?? false,
      waiting_list_double_opt_in: payload.waitingListDoubleOptIn ?? false,
    } as const

    let changed = 0

    for (const [key, value] of Object.entries(submitted) as [keyof typeof submitted, boolean][]) {
      if ((await settings.get(key)) !== value) {
        await settings.set(key, value, ctx)
        changed++
      }
    }

    session.flash('success', changed ? 'Registration settings saved.' : 'Nothing changed.')
    return response.redirect().toRoute('admin.settings.registration')
  }
}
