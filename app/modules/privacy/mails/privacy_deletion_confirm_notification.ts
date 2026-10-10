import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'

/**
 * Confirm you want your account deleted (plan §22.8.2) — for an account
 * that signs in with Google or GitHub, and so has no password to re-enter.
 */
export default class PrivacyDeletionConfirmNotification extends BaseMail {
  constructor(
    private user: User,
    private token: string
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('privacy.deletion.confirm', { token: this.token })}`

    this.message
      .to(this.user.email)
      .subject('Confirm your account deletion request')
      .htmlView('emails/privacy_deletion_confirm', { user: this.user, url })
      .textView('emails/privacy_deletion_confirm_text', { user: this.user, url })
  }
}
