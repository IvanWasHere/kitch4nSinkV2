import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'

/**
 * Sent on signup, and again whenever someone asks for a new link.
 */
export default class VerifyEmailNotification extends BaseMail {
  constructor(
    private user: User,
    private token: string
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('auth.verify_email.verify', { token: this.token })}`

    this.message
      .to(this.user.email)
      .subject(`Confirm your email address`)
      .htmlView('emails/verify_email', { user: this.user, url })
      .textView('emails/verify_email_text', { user: this.user, url })
  }
}
