import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Enqueues the recurring jobs (plan §9).
 *
 * v7 has no scheduler, so system cron drives this and it does nothing but put
 * work on the queue:
 *
 *   *\/5 * * * *  cd /app && node ace schedule:run --interval=5m
 *   0 3 * * *     cd /app && node ace schedule:run --interval=daily
 *
 * Keeping cron's job to "dispatch" rather than "do the work" means a slow
 * task cannot overlap with its own next run, and a failure retries with the
 * queue's backoff instead of waiting for the next tick.
 */
export default class ScheduleRun extends BaseCommand {
  static commandName = 'schedule:run'
  static description = 'Dispatch the recurring background jobs'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Which schedule to run: 5m | hourly | daily', default: 'daily' })
  declare interval: string

  async run() {
    const { default: queue } = await import('#queue/queue_service')
    const { default: expireInvitationsJob } = await import('#queue/jobs/expire_invitations_job')
    const { default: overdueDigestJob } = await import('#queue/jobs/overdue_digest_job')
    const { default: reconcileCountersJob } = await import('#queue/jobs/reconcile_counters_job')
    const { default: normalizePositionsJob } = await import('#queue/jobs/normalize_positions_job')

    /**
     * Milestones add rows here: SyncBillingJob in M4, PurgeDeletedFilesJob in
     * M5, RollupApiUsageJob in M6, PruneAuditLogsJob in M7 (plan §9).
     */
    const schedules: Record<
      string,
      { name: string; handler: Parameters<typeof queue.dispatch>[0] }[]
    > = {
      '5m': [],
      'hourly': [],
      'daily': [
        { name: 'expire invitations', handler: expireInvitationsJob },
        { name: 'overdue digests', handler: overdueDigestJob },
        { name: 'reconcile todo counters', handler: reconcileCountersJob },
        { name: 'normalize list positions', handler: normalizePositionsJob },
      ],
    }

    const due = schedules[this.interval]

    if (!due) {
      this.logger.error(`Unknown interval "${this.interval}". Use 5m, hourly or daily.`)
      this.exitCode = 1
      return
    }

    if (due.length === 0) {
      this.logger.info(`Nothing scheduled for "${this.interval}"`)
      return
    }

    for (const entry of due) {
      const job = await queue.dispatch(entry.handler)
      this.logger.success(`dispatched ${entry.name} as #${job.id}`)
    }
  }
}
