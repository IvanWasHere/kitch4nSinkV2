import { DateTime } from 'luxon'

import { JobSchema } from '#database/schema'

/**
 * A row on the background queue (§9).
 *
 * State is derived from timestamps rather than a status column, for the same
 * reason invitations are: a status column and an `available_at` in the past
 * are two sources of truth that drift the moment a worker is not running.
 */
export default class Job extends JobSchema {
  get isFailed() {
    return Boolean(this.failedAt)
  }

  /**
   * A worker holds this row. `reserved_by` is the flag rather than
   * `reserved_at`, because the claim is a compare-and-swap on that column —
   * see QueueService.
   */
  get isReserved() {
    return Boolean(this.reservedBy)
  }

  get isDue() {
    return !this.isFailed && !this.isReserved && this.availableAt <= DateTime.utc()
  }

  get status(): 'failed' | 'running' | 'due' | 'scheduled' {
    if (this.isFailed) return 'failed'
    if (this.isReserved) return 'running'
    return this.isDue ? 'due' : 'scheduled'
  }

  /**
   * True while working the final permitted attempt, so a handler can escalate
   * instead of failing quietly for the last time.
   */
  get isFinalAttempt() {
    return this.attempts + 1 >= this.maxAttempts
  }
}
