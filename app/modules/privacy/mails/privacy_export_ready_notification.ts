import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type PrivacyRequest from '#modules/privacy/models/privacy_request'

/**
 * Your export is ready (plan §22.8.1).
 *
 * Links to the Privacy screen, never to the archive: the download has to be
 * made signed in, so a forwarded or intercepted email is not a copy of
 * somebody's account.
 */
export default class PrivacyExportReadyNotification extends BaseMail {
  constructor(
    private user: User,
    private request: PrivacyRequest
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('settings.privacy')}`
    const expiresAt = this.request.exportExpiresAt?.toFormat("d LLLL yyyy 'at' HH:mm 'UTC'") ?? ''

    this.message
      .to(this.user.email)
      .subject('Your data export is ready')
      .htmlView('emails/privacy_export_ready', { user: this.user, url, expiresAt })
      .textView('emails/privacy_export_ready_text', { user: this.user, url, expiresAt })
  }
}
