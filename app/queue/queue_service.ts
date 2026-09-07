import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

import Job from '#models/job'
import env from '#start/env'
import { UnrecoverableJobError, type DispatchOptions, type JobHandler } from '#queue/contracts'

export const DEFAULT_QUEUE = 'default'
export const DEFAULT_MAX_ATTEMPTS = 5

/**
 * A reservation older than this is assumed to belong to a worker that died,
 * and the job is handed back. Long enough that a slow job is not stolen from
 * a healthy worker, short enough that a crash is not a long outage.
 */
export const VISIBILITY_TIMEOUT_SECONDS = 300

/**
 * The database-backed queue (D2, plan §9).
 *
 * Reservation is a compare-and-swap rather than the row lock plan §9
 * sketched:
 *
 *   UPDATE jobs SET reserved_by = ? WHERE id = ? AND reserved_by IS NULL
 *
 * An update that touches zero rows means another worker got there first, and
 * this one moves to the next candidate. Two workers can therefore never hold
 * the same job, on either engine, with no `FOR UPDATE SKIP LOCKED` on
 * Postgres and no `BEGIN IMMEDIATE` on SQLite.
 *
 * That is a deliberate departure from §9, and it pays for itself twice: the
 * queue was to be the *only* place in the codebase allowed raw SQL and the
 * *only* dialect-switched code path, and this needs neither. What it gives up
 * is `SKIP LOCKED`'s ability to avoid contending on the same head-of-queue
 * rows; workers here may read the same candidates and lose the race. At the
 * scale this queue is built for that costs a wasted read, and the fix if it
 * ever matters is `.forUpdate().skipLocked()` on Postgres inside `reserve` —
 * one method, still no raw SQL.
 *
 * The swap is on `reserved_by` rather than `reserved_at` on purpose: it is a
 * string, so the claim never has to format a timestamp by hand. Timestamps
 * are written only through Lucid, which keeps one format in the column —
 * mixing `2026-09-04 23:07:20` with `…20.355 Z` makes a text comparison on
 * SQLite stop meaning what it says.
 */
export class QueueService {
  /**
   * Identifies this worker in `reserved_by`, so a stuck job can be traced to
   * the process that was holding it.
   */
  readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`

  /**
   * Put a job on the queue.
   *
   * The payload is stored as JSON, so it must be plain data. Passing a model
   * means the worker would act on a snapshot taken at dispatch time; pass an
   * id and let the handler re-read it.
   *
   * Pass `options.client` to enqueue inside a transaction — a job that refers
   * to a row should not exist until that row is committed.
   */
  async dispatch(
    handler: Pick<JobHandler, 'name' | 'queue' | 'maxAttempts'>,
    payload: Record<string, any> = {},
    options: DispatchOptions = {}
  ): Promise<Job> {
    const delaySeconds = options.delaySeconds ?? 0

    return Job.create(
      {
        queue: options.queue ?? handler.queue ?? DEFAULT_QUEUE,
        name: handler.name,
        payload,
        attempts: 0,
        maxAttempts: options.maxAttempts ?? handler.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        availableAt: DateTime.utc().plus({ seconds: delaySeconds }),
      },
      options.client ? { client: options.client } : {}
    )
  }

  /**
   * Claim up to `limit` jobs for this worker.
   */
  async reserve(queue = DEFAULT_QUEUE, limit = 1): Promise<Job[]> {
    await this.reclaimExpired(queue)

    /**
     * Read more candidates than needed so losing a race to another worker
     * does not mean an empty poll.
     */
    const candidates = await Job.query()
      .where('queue', queue)
      .whereNull('reserved_by')
      .whereNull('failed_at')
      .where('available_at', '<=', DateTime.utc().toSQL()!)
      .orderBy('id', 'asc')
      .limit(limit * 3)

    const reserved: Job[] = []

    for (const candidate of candidates) {
      if (reserved.length >= limit) {
        break
      }

      if (await this.claim(candidate)) {
        reserved.push(candidate)
      }
    }

    return reserved
  }

  /**
   * Compare-and-swap a single job to this worker. Returns whether it won.
   *
   * The swap is on `reserved_by`, a plain string, and never on a timestamp.
   * Writing a timestamp from a query builder means formatting it by hand, and
   * a column written in two formats — Lucid's `2026-09-04 23:07:20` from one
   * path and `…20.355 Z` from another — compares as text on SQLite and stops
   * meaning what it says. Every timestamp here is written by Lucid; only
   * strings and nulls go through a raw update.
   */
  private async claim(job: Job): Promise<boolean> {
    const affected = await Job.query()
      .where('id', job.id)
      .whereNull('reserved_by')
      .update({ reserved_by: this.workerId })

    /**
     * Knex reports affected rows differently across dialects — a number on
     * SQLite, an array on Postgres — so normalise before comparing.
     */
    const rows = Array.isArray(affected) ? Number(affected[0]) : Number(affected)

    if (rows !== 1) {
      return false
    }

    /**
     * Stamp *when* it was claimed through the model, so the value matches
     * every other timestamp in the table. Between the swap above and this
     * save the row is already off-limits to other workers, because they
     * filter on `reserved_by`.
     */
    job.reservedBy = this.workerId
    job.reservedAt = DateTime.utc()
    await job.save()

    return true
  }

  /**
   * Hand a job back to the queue.
   *
   * Both columns are set from a query rather than through the model: after a
   * failed attempt `reserved_by` on the instance has returned to the value it
   * was loaded with, so Lucid sees nothing dirty and would write neither.
   */
  private async release(job: Job): Promise<void> {
    await Job.query().where('id', job.id).update({ reserved_by: null, reserved_at: null })

    job.reservedBy = null
    job.reservedAt = null
  }

  /**
   * Hand back jobs whose worker went away mid-flight. This is the only reason
   * a crash is survivable, and the reason handlers must be idempotent: the
   * work may already have been done.
   *
   * Expiry is decided from the model's own `reservedAt` rather than in SQL.
   * At any moment the reserved set is at most one row per worker slot, so
   * there is nothing to gain from pushing a timestamp comparison into a query
   * that means subtly different things on the two engines.
   */
  async reclaimExpired(queue = DEFAULT_QUEUE): Promise<number> {
    const cutoff = DateTime.utc().minus({ seconds: VISIBILITY_TIMEOUT_SECONDS })

    const held = await Job.query()
      .where('queue', queue)
      .whereNotNull('reserved_by')
      .whereNull('failed_at')

    const expired = held.filter((job) => job.reservedAt && job.reservedAt <= cutoff)

    for (const job of expired) {
      await this.release(job)
    }

    if (expired.length > 0) {
      logger.warn({ queue, count: expired.length }, 'reclaimed jobs from an expired reservation')
    }

    return expired.length
  }

  /**
   * The job finished. Rows are deleted rather than marked done: a completed
   * job has no readers, and an ever-growing table would need its own pruning
   * job. Failures are what stay, and they stay until someone looks at them.
   */
  async complete(job: Job): Promise<void> {
    await job.delete()
  }

  /**
   * The job threw. Either schedule another attempt or park it as failed.
   *
   * Backoff is exponential — `2^attempts * 30s` — so a provider having a bad
   * minute is retried soon and a provider having a bad hour is not hammered.
   */
  async fail(job: Job, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    const unrecoverable = error instanceof UnrecoverableJobError

    job.attempts += 1
    job.lastError = message.slice(0, 2000)

    if (unrecoverable || job.attempts >= job.maxAttempts) {
      job.failedAt = DateTime.utc()
      await job.save()
      await this.release(job)

      logger.error(
        { jobId: job.id, name: job.name, attempts: job.attempts, err: message },
        unrecoverable ? 'job failed permanently' : 'job failed after the final attempt'
      )
      return
    }

    job.availableAt = DateTime.utc().plus({ seconds: this.backoffSeconds(job.attempts) })
    await job.save()

    /**
     * Released last, and from a query: until this runs the row still belongs
     * to this worker, so nothing can pick it up mid-update.
     */
    await this.release(job)

    logger.warn(
      { jobId: job.id, name: job.name, attempts: job.attempts, retryAt: job.availableAt.toISO() },
      'job failed, retrying'
    )
  }

  /**
   * Seconds to wait before attempt number `attempts + 1`.
   */
  backoffSeconds(attempts: number): number {
    return 2 ** attempts * 30
  }

  /**
   * Put a failed job back on the queue, from the admin panel or the CLI.
   * Attempts reset, because a human has decided the cause is fixed.
   */
  async retry(job: Job): Promise<void> {
    job.failedAt = null
    job.attempts = 0
    job.lastError = null
    job.availableAt = DateTime.utc()
    await job.save()

    await this.release(job)
  }

  async failedJobs(limit = 50): Promise<Job[]> {
    return Job.query().whereNotNull('failed_at').orderBy('failed_at', 'desc').limit(limit)
  }

  async pendingJobs(limit = 50): Promise<Job[]> {
    return Job.query().whereNull('failed_at').orderBy('available_at', 'asc').limit(limit)
  }

  async counts(): Promise<{ pending: number; reserved: number; failed: number }> {
    const [pending] = await Job.query()
      .whereNull('failed_at')
      .whereNull('reserved_by')
      .count('* as total')
    const [reserved] = await Job.query()
      .whereNull('failed_at')
      .whereNotNull('reserved_by')
      .count('* as total')
    const [failed] = await Job.query().whereNotNull('failed_at').count('* as total')

    return {
      pending: Number(pending.$extras.total),
      reserved: Number(reserved.$extras.total),
      failed: Number(failed.$extras.total),
    }
  }

  /**
   * How long a worker waits between empty polls.
   */
  get pollIntervalMs(): number {
    return env.get('QUEUE_POLL_INTERVAL_MS', 1000)
  }

  get concurrency(): number {
    return env.get('QUEUE_WORKER_CONCURRENCY', 5)
  }
}

export default new QueueService()
