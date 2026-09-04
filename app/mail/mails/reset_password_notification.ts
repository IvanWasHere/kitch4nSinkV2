import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'

/**
 * The reset link is short-lived (one hour) and single-use; the template says
 * so, because a link that silently stops working reads as a broken product.
 */
export default class ResetPasswordNotification extends BaseMail {
  constructor(
    private user: User,
    private token: string
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('auth.password.edit', { token: this.token })}`

    this.message
      .to(this.user.email)
      .subject('Reset your password')
      .htmlView('emails/reset_password', { user: this.user, url })
      .textView('emails/reset_password_text', { user: this.user, url })
  }
}
