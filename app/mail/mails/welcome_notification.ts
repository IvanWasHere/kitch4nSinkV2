import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type Organization from '#models/organization'

/**
 * Sent once the address is confirmed, rather than at signup — until then the
 * verification email is the only one that matters, and two emails landing
 * together is noise.
 */
export default class WelcomeNotification extends BaseMail {
  constructor(
    private user: User,
    private organization: Organization
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('dashboard.index')}`

    this.message
      .to(this.user.email)
      .subject(`Welcome to ${this.organization.name}`)
      .htmlView('emails/welcome', { user: this.user, organization: this.organization, url })
      .textView('emails/welcome_text', { user: this.user, organization: this.organization, url })
  }
}
