import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type User from '#models/user'
import type Payment from '#models/payment'
import type Organization from '#models/organization'

/**
 * A receipt for a charge that succeeded.
 *
 * Sent only when the payment row is **new** (see WebhookHandler): the same
 * order arriving again is a retry, and a customer who is charged once must be
 * emailed once.
 */
export default class PaymentReceiptNotification extends BaseMail {
  constructor(
    private user: User,
    private organization: Organization,
    private payment: Payment
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('billing.index')}`

    const data = {
      user: this.user,
      organization: this.organization,
      payment: this.payment,
      amount: this.payment.formattedAmount,
      paidAt: this.payment.occurredAt.setZone(this.organization.timezone),
      url,
    }

    this.message
      .to(this.user.email)
      .subject(`Your ${this.payment.formattedAmount} payment to ${env.get('APP_NAME', 'Acme')}`)
      .htmlView('emails/payment_receipt', data)
      .textView('emails/payment_receipt_text', data)
  }
}
