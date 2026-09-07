import { compose } from '@adonisjs/core/helpers'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import Subscription from '#models/subscription'
import Organization from '#models/organization'
import { PaymentSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'

/**
 * A charge that actually happened — the transaction history on the billing
 * screen, and the record support answers "were we billed twice?" from.
 *
 * A refund never deletes or negates a row. `refundedAmountCents` grows and
 * the status moves, so the list a customer reads matches the provider's.
 */
export default class Payment extends compose(PaymentSchema, withPublicId('payment')) {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => Subscription)
  declare subscription: BelongsTo<typeof Subscription>

  get isRefunded() {
    return this.status === 'refunded' || this.status === 'partially_refunded'
  }

  /**
   * What the customer is actually out of pocket, in minor units.
   */
  get netAmountCents() {
    return this.amountCents - this.refundedAmountCents
  }

  /**
   * Money is stored as integer minor units (portability rule 8) and only ever
   * becomes a decimal at the edge — here, on its way to a template.
   */
  get formattedAmount() {
    return Payment.formatAmount(this.amountCents, this.currency)
  }

  static formatAmount(cents: number, currency: string) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
  }
}
