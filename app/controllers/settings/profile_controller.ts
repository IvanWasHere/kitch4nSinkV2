import type { HttpContext } from '@adonisjs/core/http'

import { profileValidator } from '#validators/auth'

/**
 * Settings is split across three routes rather than three cards on one page
 * (plan §13.6.4), so permissions map onto URLs. This one is always the user's
 * own profile.
 */
export default class ProfileController {
  async edit({ view }: HttpContext) {
    return view.render('pages/settings/profile')
  }

  async update({ request, response, session, auth }: HttpContext) {
    const user = auth.use('web').user!
    const { fullName } = await request.validateUsing(profileValidator)

    user.fullName = fullName
    await user.save()

    session.flash('success', 'Your profile has been updated.')
    return response.redirect().toRoute('settings.profile')
  }
}
