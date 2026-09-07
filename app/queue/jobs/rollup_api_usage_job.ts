import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

import ApiRequest from '#models/api_request'
import ApiUsageDay from '#models/api_usage_day'
import type { JobHandler } from '#queue/contracts'

/**
 * How long raw request rows are kept (plan §5.2).
 *
 * `api_requests` grows faster than anything else in the schema — one row per
 * call — and its only readers are support ("what happened at half past two?")
 * and this job. Thirty days covers both; keeping it for ever would make it
 * the largest table in the database within a year.
 */
export const RAW_RETENTION_DAYS = 30

/**
 * Rolls `api_requests` up into `api_usage_days` and prunes the raw rows
 * (plan §5.2, §9).
 *
 * The rollup is what lets the usage chart outlive the pruning: a customer
 * asking "how much were we calling you in March" gets an answer, from a table
 * with one row per day rather than one per request.
 *
 * Idempotent, which for an aggregate means the daily row is **recomputed**
 * rather than incremented. A job that added to a counter would double every
 * figure on its second run, and the queue is at-least-once (plan §9).
 */
class RollupApiUsageJob implements JobHandler {
  readonly name = 'rollup_api_usage'

  async handle() {
    const rolled = await this.rollup()
    const pruned = await this.prune()

    logger.info({ rolled, pruned }, 'rolled up API usage')
  }

  /**
   * Aggregate every raw row still present, by organisation and by day.
   *
   * Grouped in memory rather than in SQL. The alternative is a `GROUP BY`
   * over a date expression, and the two engines disagree about how to get a
   * `YYYY-MM-DD` out of a timestamp — `strftime` on SQLite, `to_char` on
   * Postgres — which is exactly the dialect-specific SQL portability rule 6
   * forbids. The row count here is bounded by 30 days of traffic and the job
   * runs nightly.
   */
  private async rollup(): Promise<number> {
    const requests = await ApiRequest.query().orderBy('id', 'asc')

    const totals = new Map<
      string,
      { organizationId: number; day: string; requests: number; errors: number }
    >()

    for (const request of requests) {
      const day = request.createdAt.toUTC().toFormat('yyyy-MM-dd')
      const key = `${request.organizationId}:${day}`

      const entry = totals.get(key) ?? {
        organizationId: request.organizationId,
        day,
        requests: 0,
        errors: 0,
      }

      entry.requests++

      if (request.isError) {
        entry.errors++
      }

      totals.set(key, entry)
    }

    for (const entry of totals.values()) {
      /**
       * Recomputed, not incremented — see the note on idempotency above.
       * `unique(organization_id, day)` is what makes this an upsert rather
       * than a growing pile of partial days.
       */
      const existing = await ApiUsageDay.query()
        .where('organization_id', entry.organizationId)
        .where('day', entry.day)
        .first()

      if (existing) {
        existing.requests = entry.requests
        existing.errors = entry.errors
        await existing.save()
        continue
      }

      await ApiUsageDay.create(entry)
    }

    return totals.size
  }

  /**
   * Drop raw rows past the retention window.
   *
   * Decided from the model's own timestamp rather than in SQL, because a
   * `where created_at < ?` compares as text on SQLite and as a timestamp on
   * Postgres (CONTRIBUTING).
   *
   * Only rows whose day has already been rolled up are removed, so a
   * pruning run that outpaces the rollup cannot lose a day's numbers.
   */
  private async prune(): Promise<number> {
    const cutoff = DateTime.utc().minus({ days: RAW_RETENTION_DAYS })

    const candidates = await ApiRequest.query().orderBy('id', 'asc')
    const expired = candidates.filter((request) => request.createdAt <= cutoff)

    let pruned = 0

    for (const request of expired) {
      const day = request.createdAt.toUTC().toFormat('yyyy-MM-dd')

      const rolled = await ApiUsageDay.query()
        .where('organization_id', request.organizationId)
        .where('day', day)
        .first()

      if (!rolled) {
        continue
      }

      await ApiRequest.query().where('id', request.id).delete()
      pruned++
    }

    return pruned
  }
}

export default new RollupApiUsageJob()
