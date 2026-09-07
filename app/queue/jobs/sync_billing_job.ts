import logger from '@adonisjs/core/services/logger'

import billing from '#billing/reconciliation'
import type { JobHandler } from '#queue/contracts'

/**
 * Nightly reconciliation (plan §7.5).
 *
 * Cheap insurance against a webhook that never arrived. It **reports** every
 * difference it finds and only corrects the one that costs somebody money —
 * a status that disagrees. Leaving a customer on a plan the provider says
 * they cancelled costs us; leaving them off one they are paying for costs us
 * the customer.
 *
 * Everything else is logged and left alone, for the same reason
 * `ReconcileCountersJob` alerts rather than repairs: a job that quietly fixes
 * the same drift every night hides the bug producing it.
 */
class SyncBillingJob implements JobHandler {
  readonly name = 'sync_billing'

  async handle() {
    const report = await billing.reconcile()

    logger.info(
      {
        checked: report.checked,
        drifted: report.drifted.length,
        missing: report.missing.length,
        corrected: report.corrected,
      },
      'reconciled subscriptions against the payment provider'
    )

    for (const entry of report.drifted) {
      logger.warn(entry, 'a subscription drifted from the provider')
    }

    for (const entry of report.missing) {
      logger.error(entry, 'the provider has no record of a subscription we think is live')
    }
  }
}

export default new SyncBillingJob()
