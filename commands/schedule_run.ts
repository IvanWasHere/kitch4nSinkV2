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
    const { default: jobs, isScheduleInterval } = await import('#queue/registry')

    /**
     * What runs on this tick comes from the job registry (`start/jobs.ts`),
     * so a job added or removed with a feature is dispatched — or not —
     * without editing this command.
     */
    if (!isScheduleInterval(this.interval)) {
      this.logger.error(`Unknown interval "${this.interval}". Use 5m, hourly or daily.`)
      this.exitCode = 1
      return
    }

    const due = jobs.due(this.interval)

    if (due.length === 0) {
      this.logger.info(`Nothing scheduled for "${this.interval}"`)
      return
    }

    for (const entry of due) {
      const job = await queue.dispatch(entry.handler)
      this.logger.success(`dispatched ${entry.label} as #${job.id}`)
    }
  }
}
