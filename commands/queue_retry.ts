import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Put failed jobs back on the queue (plan §4).
 *
 * The same action the admin panel's one-click retry performs, for when the
 * fix was a deploy rather than a click.
 *
 *   node ace queue:retry --id=42
 *   node ace queue:retry --all
 *   node ace queue:retry --all --name=send_mail
 */
export default class QueueRetry extends BaseCommand {
  static commandName = 'queue:retry'
  static description = 'Retry failed background jobs'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.number({ description: 'Retry one job by id' })
  declare id: number

  @flags.boolean({ description: 'Retry every failed job', default: false })
  declare all: boolean

  @flags.string({ description: 'Only jobs with this name' })
  declare name: string

  async run() {
    const { default: Job } = await import('#models/job')
    const { default: queue } = await import('#queue/queue_service')

    if (!this.id && !this.all) {
      this.logger.error('Pass --id=<n> or --all')
      this.exitCode = 1
      return
    }

    const query = Job.query().whereNotNull('failed_at')

    if (this.id) {
      query.where('id', this.id)
    }

    if (this.name) {
      query.where('name', this.name)
    }

    const jobs = await query

    if (jobs.length === 0) {
      this.logger.info('No failed jobs matched')
      return
    }

    for (const job of jobs) {
      await queue.retry(job)
      this.logger.success(`queued ${job.name} #${job.id} for another attempt`)
    }
  }
}
