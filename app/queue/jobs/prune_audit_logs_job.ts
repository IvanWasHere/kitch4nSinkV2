import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

import AuditLog from '#models/audit_log'
import type { JobHandler } from '#queue/contracts'

/**
 * How long an audit entry is kept (plan §9).
 *
 * Two years, which is longer than anything else in this schema, and
 * deliberately so: the questions an audit trail answers arrive late — a
 * chargeback, a dispute about who cancelled something, a security review.
 * Pruning it on the same 30-day schedule as request logs would defeat the
 * point of having it.
 */
export const AUDIT_RETENTION_DAYS = 730

/**
 * Drops audit entries past the retention window.
 *
 * The **only** thing in the application that deletes an audit row — nothing
 * updates one at all. A trail that the application can edit is not a trail,
 * so this is kept to one place with one rule.
 */
class PruneAuditLogsJob implements JobHandler {
  readonly name = 'prune_audit_logs'

  async handle() {
    const cutoff = DateTime.utc().minus({ days: AUDIT_RETENTION_DAYS })

    /**
     * Expiry is decided from the model's own timestamp rather than in SQL:
     * a `where created_at < ?` compares as text on SQLite and as a timestamp
     * on Postgres (CONTRIBUTING).
     *
     * Read in batches so two years of history does not arrive in one array.
     */
    let pruned = 0

    for (let pass = 0; pass < 100; pass++) {
      const candidates = await AuditLog.query().orderBy('id', 'asc').limit(1000)
      const expired = candidates.filter((entry) => entry.createdAt <= cutoff)

      if (expired.length === 0) {
        break
      }

      await AuditLog.query()
        .whereIn(
          'id',
          expired.map((entry) => entry.id)
        )
        .delete()

      pruned += expired.length

      /**
       * A partial batch means the oldest rows are now inside the window, so
       * there is nothing further back to find.
       */
      if (expired.length < candidates.length) {
        break
      }
    }

    logger.info({ pruned, retentionDays: AUDIT_RETENTION_DAYS }, 'pruned audit logs')
  }
}

export default new PruneAuditLogsJob()
