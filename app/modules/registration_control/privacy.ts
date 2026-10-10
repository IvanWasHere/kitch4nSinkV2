import type User from '#models/user'
import type { PrivacyContributor, PrivacyEraseContext } from '#privacy/registry'
import WaitingListEntry from '#modules/registration_control/models/waiting_list_entry'

/**
 * Registration Control's share of a person's data (plan §22.8): the
 * waiting-list entry for their address, if they joined before signing up.
 * Matched by email — the list predates the account, so there is no user id
 * to follow.
 */
export const waitingListPrivacyContributor: PrivacyContributor = {
  key: 'waitingList',
  describes: 'Your waiting-list entry, if you joined the list before creating your account.',
  covers: [],

  async export(user: User) {
    const entry = await WaitingListEntry.findBy('email', user.email)

    if (!entry) {
      return null
    }

    return {
      status: entry.status,
      joinedAt: entry.createdAt.toISO(),
      confirmedAt: entry.confirmedAt?.toISO() ?? null,
      convertedAt: entry.convertedAt?.toISO() ?? null,
    }
  },

  /**
   * The entry is just an address and a status — nothing worth keeping once
   * the person is gone. Found by the address they had, since the user row's
   * has been overwritten by now.
   */
  async erase(_user: User, { trx, originalEmail }: PrivacyEraseContext) {
    await WaitingListEntry.query({ client: trx })
      .where('email', originalEmail.toLowerCase())
      .delete()
  },
}
