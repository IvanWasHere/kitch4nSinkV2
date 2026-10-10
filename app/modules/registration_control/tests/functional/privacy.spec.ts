import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

import WaitingListEntry from '#modules/registration_control/models/waiting_list_entry'
import { waitingListPrivacyContributor } from '#modules/registration_control/privacy'
import { createWorkspace } from '#tests/helpers'

/**
 * Registration Control's share of a privacy export and deletion (plan §22.8).
 */
test.group('Waiting list — privacy', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('the export holds the entry for the person’s address', async ({ assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    await WaitingListEntry.create({
      email: 'jane@example.com',
      status: 'converted',
      doubleOptInRequired: true,
    })

    const exported = (await waitingListPrivacyContributor.export(user)) as { status: string }

    assert.equal(exported.status, 'converted')
  })

  /**
   * By the time a contributor erases, the user row's address has already been
   * overwritten — so the entry is found by the address handed over in the
   * context, not by `user.email`.
   */
  test('erase removes the entry found by the old address', async ({ assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    await WaitingListEntry.create({
      email: 'jane@example.com',
      status: 'converted',
      doubleOptInRequired: true,
    })
    user.email = `email${user.id}@deleteduser.com`

    await db.transaction((trx) =>
      waitingListPrivacyContributor.erase!(user, {
        trx,
        lastMember: true,
        originalEmail: 'jane@example.com',
        afterCommit: () => {},
      })
    )

    assert.isNull(await WaitingListEntry.findBy('email', 'jane@example.com'))
  })
})
