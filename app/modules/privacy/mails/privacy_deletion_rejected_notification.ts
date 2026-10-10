import { BaseMail } from '@adonisjs/mail'

import type User from '#models/user'

/**
 * We did not delete your account, and why (plan §22.8.2).
 */
export default class PrivacyDeletionRejectedNotification extends BaseMail {
  constructor(
    private user: User,
    private reason: string
  ) {
    super()
  }

  prepare() {
    this.message
      .to(this.user.email)
      .subject('About your account deletion request')
      .htmlView('emails/privacy_deletion_rejected', { user: this.user, reason: this.reason })
      .textView('emails/privacy_deletion_rejected_text', { user: this.user, reason: this.reason })
  }
}
