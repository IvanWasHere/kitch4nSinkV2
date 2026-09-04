import { errors as authErrors } from '@adonisjs/auth'
import type { HttpContext } from '@adonisjs/core/http'

import StaffUser from '#models/staff_user'
import { loginValidator } from '#validators/auth'
import { startTwoFactorChallenge } from '#auth/two_factor_challenge'

/**
 * Staff sign-in, on its own table and its own guard (D5).
 *
 * Two-factor is mandatory here: a staff account can read every tenant's
 * subscription state and impersonate their users, so a password alone is not
 * an acceptable credential. An account without it is sent to set it up rather
 * than being let in.
 */
export default class AdminSessionController {
  async create({ view }: HttpContext) {
    return view.render('pages/admin/login')
  }

  async store({ request, response, session }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    let staff: StaffUser
    try {
      staff = await StaffUser.verifyCredentials(email, password)
    } catch (error) {
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        session.flash('error', 'Those credentials do not match our records.')
        return response.redirect().toRoute('admin.session.create')
      }
      throw error
    }

    if (staff.isDisabled) {
      session.flash('error', 'That account has been disabled.')
      return response.redirect().toRoute('admin.session.create')
    }

    if (!staff.hasTwoFactor) {
      session.flash(
        'error',
        'Two-factor authentication is required for staff accounts. Ask an administrator to enrol you.'
      )
      return response.redirect().toRoute('admin.session.create')
    }

    startTwoFactorChallenge(session, 'staff', staff.id)
    return response.redirect().toRoute('admin.two_factor.create')
  }

  async destroy({ response, auth }: HttpContext) {
    await auth.use('staff').logout()
    return response.redirect().toRoute('admin.session.create')
  }
}
