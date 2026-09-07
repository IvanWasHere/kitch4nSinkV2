import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type Organization from '#models/organization'
import type Subscription from '#models/subscription'

/**
 * The subscription ended and the workspace is back on Free.
 *
 * It says what the soft-lock guarantees (plan §7.4): every list, todo and
 * member is still there and still editable, and only new creates beyond the
 * free ceiling are blocked. That sentence is the difference between a
 * downgrade and a data-loss scare.
 */
export default class SubscriptionCanceledNotification extends BaseMail {
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
      endedAt: (this.subscription.canceledAt ?? this.subscription.currentPeriodEnd)?.setZone(
        this.organization.timezone
      ),
      url,
    }

    this.message
      .to(this.user.email)
      .subject(`${this.organization.name} is back on the Free plan`)
      .htmlView('emails/subscription_canceled', data)
      .textView('emails/subscription_canceled_text', data)
  }
}
