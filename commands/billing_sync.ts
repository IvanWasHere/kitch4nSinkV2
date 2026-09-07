import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Diff local subscriptions against the payment provider (plan §7.5).
 *
 * The same reconciliation the nightly `SyncBillingJob` runs, driven by hand:
 * this is what somebody reaches for when a customer says "I upgraded but
 * nothing changed" and the webhook is nowhere in the ledger.
 *
 *   node ace billing:sync             # report and correct statuses
 *   node ace billing:sync --dry-run   # report only
 */
export default class BillingSync extends BaseCommand {
  static commandName = 'billing:sync'
  static description = 'Reconcile local subscriptions against the payment provider'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.boolean({ description: 'Report drift without correcting anything', default: false })
  declare dryRun: boolean

  async run() {
    const { default: billing } = await import('#billing/reconciliation')

    /**
     * A dry run must not write, so it goes through the read-only diff rather
     * than through `reconcile()` with a flag threaded into it — a "don't
     * write" boolean passed down four call sites is how a dry run eventually
     * writes something.
     */
    const report = this.dryRun ? await billing.diff() : await billing.reconcile()

    this.logger.info(`checked ${report.checked} subscription(s)`)

    for (const entry of report.drifted) {
      this.logger.warning(
        `#${entry.subscriptionId} (org ${entry.organizationId}) ${entry.field}: ` +
          `ours=${entry.ours} theirs=${entry.theirs}`
      )
    }

    for (const entry of report.missing) {
      this.logger.error(
        `#${entry.subscriptionId} (org ${entry.organizationId}) — the provider has no record of ` +
          `${entry.providerSubscriptionId}`
      )
    }

    if (report.drifted.length === 0 && report.missing.length === 0) {
      this.logger.success('no drift')
      return
    }

    if (this.dryRun) {
      this.logger.info('dry run — nothing was changed')
    } else if (report.corrected > 0) {
      this.logger.success(`corrected ${report.corrected} subscription status(es)`)
    }

    /**
     * A non-zero exit so CI or a cron wrapper can notice. Drift is not a
     * crash, but it is never routine.
     */
    this.exitCode = 1
  }
}
