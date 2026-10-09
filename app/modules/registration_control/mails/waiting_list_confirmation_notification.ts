import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

/**
 * The double opt-in email (plan §22.5). Sent when somebody joins the waiting
 * list while confirmation is required, and again if they join a second time
 * before confirming — the first link may have expired.
 */
export default class WaitingListConfirmationNotification extends BaseMail {
  constructor(
    private email: string,
    private token: string
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('waitlist.confirm', { token: this.token })}`

    this.message
      .to(this.email)
      .subject('Confirm your place on the waiting list')
      .htmlView('emails/waiting_list_confirmation', { url })
      .textView('emails/waiting_list_confirmation_text', { url })
  }
}
