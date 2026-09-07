import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

import Notification from '#models/notification'
import type { JobHandler } from '#queue/contracts'

/**
 * How long a deleted announcement is recoverable (plan §20.8).
 *
 * Thirty days, matching `PurgeDeletedFilesJob`: an announcement deleted by
 * mistake is as recoverable as a file deleted by mistake, and for the same
 * reason — somebody notices a week later, not a minute later.
 */
export const NOTIFICATION_RETENTION_DAYS = 30

/**
 * Hard-deletes announcements whose soft delete has expired.
 *
 * The only thing in the application that removes a `notifications` row. There
 * is no object storage behind it and no per-user state pointing at it — the
 * unread mechanism is a timestamp on the user (plan §20.4), not a row per
 * recipient — so unlike a purged file this is a single delete with nothing to
 * order around it.
 *
 * Idempotent: a row already gone is not an error.
 */
class PruneNotificationsJob implements JobHandler {
  readonly name = 'prune_notifications'

  async handle() {
    const cutoff = DateTime.utc().minus({ days: NOTIFICATION_RETENTION_DAYS })

    /**
     * Expiry is decided from the model's own timestamp rather than in SQL: a
     * `where deleted_at < ?` compares as text on SQLite and as a timestamp on
     * Postgres (CONTRIBUTING).
     */
    const deleted = await Notification.query().whereNotNull('deleted_at').orderBy('id', 'asc')
    const expired = deleted.filter(
      (notification) => notification.deletedAt && notification.deletedAt <= cutoff
    )

    if (expired.length === 0) {
      logger.info({ pruned: 0 }, 'pruned deleted announcements')
      return
    }

    await Notification.query()
      .whereIn(
        'id',
        expired.map((notification) => notification.id)
      )
      .delete()

    logger.info({ pruned: expired.length }, 'pruned deleted announcements')
  }
}

export default new PruneNotificationsJob()
