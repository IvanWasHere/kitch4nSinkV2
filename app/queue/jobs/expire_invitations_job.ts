import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'

import Invitation from '#models/invitation'
import type { JobHandler } from '#queue/contracts'

/**
 * Tidies away invitations that have lapsed.
 *
 * Expiry is already *decided* by `expires_at` — a lapsed invitation stops
 * working and stops holding a seat whether or not this has run (§5.5). This
 * only marks them revoked so the members screen and the admin panel stop
 * listing rows nobody can act on.
 *
 * Idempotent by construction: it only touches rows that are still open and
 * already past their expiry, so a second run finds nothing.
 */
class ExpireInvitationsJob implements JobHandler {
  readonly name = 'expire_invitations'

  async handle() {
    const stale = await Invitation.query()
      .whereNull('accepted_at')
      .whereNull('revoked_at')
      .where('expires_at', '<=', DateTime.utc().toSQL()!)

    if (stale.length === 0) {
      return
    }

    for (const invitation of stale) {
      invitation.revokedAt = DateTime.utc()
      await invitation.save()
    }

    logger.info({ count: stale.length }, 'expired invitations')
  }
}

export default new ExpireInvitationsJob()
