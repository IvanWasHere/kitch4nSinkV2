import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import type Job from '#models/job'

/**
 * A background job (plan §9).
 *
 * Delivery is **at-least-once**: a worker that crashes after doing the work
 * but before marking the job done will run it again when the reservation is
 * reclaimed. Every handler must therefore be idempotent — running it twice
 * must have the same effect as running it once. That is not a nicety; it is
 * the contract the queue can actually keep.
 */
export interface JobHandler<Payload = Record<string, any>> {
  /**
   * Stable identifier stored in `jobs.name`. Renaming one strands the jobs
   * already queued under the old name, so treat it as permanent.
   */
  readonly name: string

  /**
   * Which queue this runs on. Separating a slow queue from a latency-
   * sensitive one is what stops a nightly bulk job delaying a password reset.
   */
  readonly queue?: string

  /**
   * Attempts before the job is parked as failed. Defaults to the queue's own
   * default when omitted.
   */
  readonly maxAttempts?: number

  handle(payload: Payload, context: JobContext): Promise<void>
}

export interface JobContext {
  /**
   * The row being worked. Handlers read `attempts` from it to behave
   * differently on a final attempt — logging louder, or giving up quietly.
   */
  job: Job

  /**
   * True on the last attempt, so a handler can escalate rather than fail
   * silently for the fifth time.
   */
  isFinalAttempt: boolean
}

export interface DispatchOptions {
  queue?: string
  maxAttempts?: number

  /**
   * Enqueue inside an existing transaction, so the job and the rows it is
   * about commit or roll back together. Without this a caller that writes a
   * row and then dispatches can end up with the row and no job — or, worse,
   * a worker that picks the job up before the row it needs is visible.
   */
  client?: TransactionClientContract

  /**
   * Hold the job back until a moment in the future. Used by the scheduler and
   * by anything that wants a delay without sleeping a worker.
   */
  delaySeconds?: number
}

/**
 * Thrown by a handler that wants to fail permanently rather than be retried —
 * a payload that can never become valid, for instance.
 */
export class UnrecoverableJobError extends Error {
  readonly unrecoverable = true
}
