import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

import audit from '#audit/audit_service'
import type { JobHandler } from '#queue/contracts'
import WaitingListEntry from '#modules/registration_control/models/waiting_list_entry'
import waitingList from '#modules/registration_control/services/waiting_list_service'
import '#modules/registration_control/audit_actions'

/**
 * Marks waiting-list entries as converted once their address has an account
 * (plan §22.5).
 *
 * A sweep rather than a hook in registration, on purpose: core's signup path
 * must not know the waiting list exists (plan §22.4), and "this person now has
 * an account" is a fact that can wait until tonight.
 *
 * Pending entries are included as well as confirmed ones — somebody who never
 * clicked the link but signed up anyway is still somebody the list no longer
 * needs to wait for. Cancelled entries are left alone: a cancel is a staff
 * decision, and an account appearing does not overrule it.
 *
 * Idempotent: a converted entry no longer matches, so a second run finds
 * nothing to do.
 */
class MarkWaitingListConvertedJob implements JobHandler {
  readonly name = 'mark_waiting_list_converted'

  async handle() {
    const entries = await WaitingListEntry.query()
      .whereIn('status', ['pending_confirmation', 'confirmed'])
      .whereIn('email', db.from('users').select('email'))

    for (const entry of entries) {
      const before = entry.status

      await waitingList.markConverted(entry)

      await audit.recordSystemAction({
        action: 'waitlist.converted',
        subjectType: 'WaitingListEntry',
        subjectId: entry.publicId,
        metadata: { from: before, to: entry.status, reason: 'account_created' },
      })
    }

    logger.info(
      { event: 'waiting_list.converted', converted: entries.length },
      'marked waiting-list entries converted'
    )
  }
}

export default new MarkWaitingListConvertedJob()
