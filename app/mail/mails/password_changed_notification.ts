import { BaseMail } from '@adonisjs/mail'
import env from '#start/env'

import type User from '#models/user'

/**
 * Not a courtesy — this is how someone finds out their account was taken
 * over, so it is sent on every password change including a successful reset.
 */
export default class PasswordChangedNotification extends BaseMail {
  constructor(private user: User) {
    super()
  }

  prepare() {
    this.message
      .to(this.user.email)
      .subject('Your password was changed')
      .htmlView('emails/password_changed', { user: this.user, appUrl: env.get('APP_URL') })
      .textView('emails/password_changed_text', { user: this.user, appUrl: env.get('APP_URL') })
  }
}
