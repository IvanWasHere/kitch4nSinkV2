import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type Organization from '#models/organization'
import type Subscription from '#models/subscription'
import { planFor } from '#config/plans'

/**
 * Sent when a subscription becomes active — the receipt for the *plan*, not
 * for the money, which gets its own email.
 *
 * Only ever triggered by a status transition in the webhook handler, so a
 * redelivered `subscription.active` cannot send it twice.
 */
export default class SubscriptionActivatedNotification extends BaseMail {
  constructor(
    private user: User,
    private organization: Organization,
    private subscription: Subscription
  ) {
    super()
  }

  prepare() {
    const plan = planFor(this.subscription.planKey)
    const url = `${env.get('APP_URL')}${router.makeUrl('billing.index')}`

    const data = {
      user: this.user,
      organization: this.organization,
      plan,
      subscription: this.subscription,
      renewsAt: this.subscription.currentPeriodEnd?.setZone(this.organization.timezone),
      url,
    }

    this.message
      .to(this.user.email)
      .subject(`${this.organization.name} is on ${plan.name}`)
      .htmlView('emails/subscription_activated', data)
      .textView('emails/subscription_activated_text', data)
  }
}
