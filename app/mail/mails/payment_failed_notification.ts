import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type Organization from '#models/organization'
import type Subscription from '#models/subscription'

/**
 * Dunning (plan §7.5).
 *
 * The tone matters: nothing has been taken away. `past_due` keeps the
 * workspace fully usable, and the email says so — a customer who thinks their
 * team has been locked out mid-sprint churns over a card that simply expired.
 */
export default class PaymentFailedNotification extends BaseMail {
  constructor(
    private user: User,
    private organization: Organization,
    private subscription: Subscription
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('billing.index')}`

    const data = {
      user: this.user,
      organization: this.organization,
      subscription: this.subscription,
      /**
       * The end of the period they have already paid for — the honest answer
       * to "how long do I have?".
       */
      graceEndsAt: this.subscription.currentPeriodEnd?.setZone(this.organization.timezone),
      url,
    }

    this.message
      .to(this.user.email)
      .subject(`We could not take payment for ${this.organization.name}`)
      .htmlView('emails/payment_failed', data)
      .textView('emails/payment_failed_text', data)
  }
}
