import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * The queue worker (plan §9, §16).
 *
 * Runs as a second process alongside the web server — `worker: node ace
 * queue:work` in a Procfile, a second container, or a systemd unit.
 *
 *   node ace queue:work                    the default queue
 *   node ace queue:work --queue=mail       one queue
 *   node ace queue:work --once             drain what is due, then exit
 */
export default class QueueWork extends BaseCommand {
  static commandName = 'queue:work'
  static description = 'Process background jobs'

  static options: CommandOptions = {
    startApp: true,
    staysAlive: true,
  }

  @flags.array({ description: 'Queues to work, in priority order', default: ['default', 'mail'] })
  declare queue: string[]

  @flags.number({ description: 'Jobs to run at once' })
  declare concurrency: number

  @flags.boolean({
    description: 'Process everything currently due and exit, instead of polling',
    default: false,
  })
  declare once: boolean

  /**
   * Flipped by SIGINT/SIGTERM. The loop finishes the batch it is on before
   * exiting, so a deploy does not kill a job half-way and rely on the
   * visibility timeout to notice.
   */
  #stopping = false

  async run() {
    const { default: queue } = await import('#queue/queue_service')
    const { handlerFor } = await import('#queue/registry')
    const { UnrecoverableJobError } = await import('#queue/contracts')
    const { default: router } = await import('@adonisjs/core/services/router')

    /**
     * Routes are committed by the HTTP server, which never starts here. A
     * worker that renders an email still needs `urlFor`, so without this every
     * link in every queued message fails to resolve — quietly, because the
     * mailer logs a render failure rather than crashing the job.
     */
    if (!router.commited) {
      router.commit()
    }

    const concurrency = this.concurrency ?? queue.concurrency

    this.logger.info(
      `worker ${queue.workerId} started · queues: ${this.queue.join(', ')} · concurrency: ${concurrency}`
    )

    const shutdown = (signal: string) => {
      if (this.#stopping) {
        return
      }
      this.#stopping = true
      this.logger.info(`${signal} received — finishing the current batch`)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))

    while (!this.#stopping) {
      let workedSomething = false

      for (const queueName of this.queue) {
        if (this.#stopping) {
          break
        }

        const jobs = await queue.reserve(queueName, concurrency)

        if (jobs.length === 0) {
          continue
        }

        workedSomething = true

        /**
         * Reserved jobs run together. Each settles on its own, so one
         * failure neither takes down the batch nor blocks the others.
         */
        await Promise.all(
          jobs.map(async (job) => {
            const handler = handlerFor(job.name)

            if (!handler) {
              /**
               * A job whose handler has gone is parked immediately rather
               * than retried five times: no amount of waiting will make the
               * code exist.
               */
              await queue.fail(job, new UnrecoverableJobError(`No handler for job "${job.name}"`))
              return
            }

            const startedAt = Date.now()

            try {
              await handler.handle(job.payload ?? {}, { job, isFinalAttempt: job.isFinalAttempt })
              await queue.complete(job)

              this.logger.info(`${job.name} #${job.id} done in ${Date.now() - startedAt}ms`)
            } catch (error) {
              await queue.fail(job, error)
            }
          })
        )
      }

      if (this.once && !workedSomething) {
        break
      }

      if (!workedSomething && !this.#stopping) {
        await this.sleep(queue.pollIntervalMs)
      }
    }

    this.logger.info('worker stopped')
    await this.terminate()
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
