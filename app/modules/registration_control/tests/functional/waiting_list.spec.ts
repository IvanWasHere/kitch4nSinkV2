import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import settings from '#settings/settings_service'
import WaitingListEntry from '#modules/registration_control/models/waiting_list_entry'
import { createWorkspace, queuedMails, queuedMailsTo } from '#tests/helpers'

/**
 * The public waiting list (plan §22.5).
 */
test.group('Waiting list', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    await settings.set('registration_enabled', false)
    mail.fake()
    return () => mail.restore()
  })

  const JOINED =
    'If this email can be added to the waiting list, we will send further instructions.'

  async function join(client: any, email: string) {
    return client.post('/waitlist').form({ email }).withCsrfToken().redirects(0)
  }

  /**
   * The link in the email, recovered from the queued message — the only place
   * the token exists.
   */
  async function confirmationPath(email: string): Promise<string> {
    const mails = await queuedMailsTo(email)
    const last = mails[mails.length - 1]
    const match = last.text.match(/\/waitlist\/confirm\/[A-Za-z0-9_-]+/)

    return match![0]
  }

  test('a closed signup page sends people to the waiting list', async ({ client }) => {
    const response = await client.get('/signup').redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/waitlist')
  })

  test('a closed signup POST lands on the waiting list too', async ({ client }) => {
    const response = await client
      .post('/signup')
      .form({ email: 'jane@example.com' })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/waitlist')
  })

  test('the form is shown while registration is closed', async ({ client }) => {
    const response = await client.get('/waitlist')

    response.assertStatus(200)
    response.assertTextIncludes('Join the waiting list')
  })

  test('while registration is open the list sends people to signup', async ({ client, assert }) => {
    await settings.set('registration_enabled', true)

    const page = await client.get('/waitlist').redirects(0)
    page.assertHeader('location', '/signup')

    const submit = await join(client, 'jane@example.com')
    submit.assertHeader('location', '/signup')
    assert.isNull(await WaitingListEntry.findBy('email', 'jane@example.com'))
  })

  test('joining with double opt-in creates a pending entry and emails a link', async ({
    client,
    assert,
  }) => {
    const response = await join(client, 'jane@example.com')

    response.assertHeader('location', '/waitlist')
    response.assertFlashMessage('success', JOINED)

    const entry = await WaitingListEntry.findByOrFail('email', 'jane@example.com')
    assert.equal(entry.status, 'pending_confirmation')
    assert.isTrue(entry.doubleOptInRequired)
    assert.isNull(entry.confirmedAt)
    assert.match(entry.publicId, /^wle_/)

    const [queued] = await queuedMailsTo('jane@example.com')
    assert.equal(queued.subject, 'Confirm your place on the waiting list')

    const path = await confirmationPath('jane@example.com')
    const token = path.split('/').pop()!
    assert.notEqual(entry.confirmationTokenHash, token, 'only the hash is stored')
    assert.lengthOf(entry.confirmationTokenHash!, 64)
  })

  test('the address is normalised, so it cannot join twice in capitals', async ({
    client,
    assert,
  }) => {
    await join(client, '  Jane@Example.COM ')
    await join(client, 'jane@example.com')

    const entries = await WaitingListEntry.all()
    assert.lengthOf(entries, 1)
    assert.equal(entries[0].email, 'jane@example.com')
  })

  test('following the link confirms the entry, once', async ({ client, assert }) => {
    await join(client, 'jane@example.com')
    const path = await confirmationPath('jane@example.com')

    const first = await client.get(path)
    first.assertStatus(200)
    first.assertTextIncludes('You are on the waiting list')

    const entry = await WaitingListEntry.findByOrFail('email', 'jane@example.com')
    assert.equal(entry.status, 'confirmed')
    assert.isNotNull(entry.confirmedAt)

    const second = await client.get(path)
    second.assertTextIncludes('already confirmed')
  })

  test('an expired link confirms nothing, and joining again sends a new one', async ({
    client,
    assert,
  }) => {
    await join(client, 'jane@example.com')
    const stale = await confirmationPath('jane@example.com')

    const entry = await WaitingListEntry.findByOrFail('email', 'jane@example.com')
    entry.confirmationExpiresAt = DateTime.utc().minus({ minutes: 1 })
    await entry.save()

    const expired = await client.get(stale)
    expired.assertTextIncludes('That link has expired')
    await entry.refresh()
    assert.equal(entry.status, 'pending_confirmation')

    await join(client, 'jane@example.com')
    const fresh = await confirmationPath('jane@example.com')
    assert.notEqual(fresh, stale)

    const confirmed = await client.get(fresh)
    confirmed.assertTextIncludes('You are on the waiting list')

    const retired = await client.get(stale)
    retired.assertTextIncludes('That link is not valid')
  })

  test('a made-up link is invalid', async ({ client }) => {
    const response = await client.get('/waitlist/confirm/not-a-real-token')

    response.assertStatus(200)
    response.assertTextIncludes('That link is not valid')
  })

  test('without double opt-in an entry is confirmed at once and nothing is sent', async ({
    client,
    assert,
  }) => {
    await settings.set('waiting_list_double_opt_in', false)

    await join(client, 'jane@example.com')

    const entry = await WaitingListEntry.findByOrFail('email', 'jane@example.com')
    assert.equal(entry.status, 'confirmed')
    assert.isFalse(entry.doubleOptInRequired)
    assert.isNotNull(entry.confirmedAt)
    assert.lengthOf(await queuedMailsTo('jane@example.com'), 0)
  })

  test('changing the setting does not touch entries already on the list', async ({
    client,
    assert,
  }) => {
    await join(client, 'pending@example.com')

    await settings.set('waiting_list_double_opt_in', false)
    await join(client, 'later@example.com')

    const pending = await WaitingListEntry.findByOrFail('email', 'pending@example.com')
    assert.equal(pending.status, 'pending_confirmation', 'not silently confirmed')
    assert.isTrue(pending.doubleOptInRequired)

    const later = await WaitingListEntry.findByOrFail('email', 'later@example.com')
    assert.equal(later.status, 'confirmed')
  })

  /**
   * The enumeration test. An address with an account and one without get the
   * same response, and the one with an account gets no entry and no email.
   */
  test('an address that already has an account is indistinguishable', async ({
    client,
    assert,
  }) => {
    /**
     * The account has to exist before registration closed — setup closed it,
     * so it is reopened just long enough to create one.
     */
    await settings.set('registration_enabled', true)
    await createWorkspace({ email: 'taken@example.com' })
    await settings.set('registration_enabled', false)
    const before = await queuedMails()

    const taken = await join(client, 'taken@example.com')
    const free = await join(client, 'free@example.com')

    for (const response of [taken, free]) {
      response.assertStatus(302)
      response.assertHeader('location', '/waitlist')
      response.assertFlashMessage('success', JOINED)
    }

    assert.isNull(await WaitingListEntry.findBy('email', 'taken@example.com'))
    assert.lengthOf(await queuedMailsTo('taken@example.com'), 0)
    const after = await queuedMails()
    assert.equal(after.length, before.length + 1, 'only the free address got mail')
  })

  test('a cancelled entry stays cancelled when the address joins again', async ({
    client,
    assert,
  }) => {
    await join(client, 'jane@example.com')
    const entry = await WaitingListEntry.findByOrFail('email', 'jane@example.com')
    entry.status = 'cancelled'
    await entry.save()
    const before = await queuedMailsTo('jane@example.com')

    const response = await join(client, 'jane@example.com')

    response.assertFlashMessage('success', JOINED)
    await entry.refresh()
    assert.equal(entry.status, 'cancelled')
    assert.lengthOf(await queuedMailsTo('jane@example.com'), before.length)
  })

  test('a malformed address is a validation error, not a silent success', async ({
    client,
    assert,
  }) => {
    const response = await join(client, 'not-an-email')

    response.assertStatus(302)
    assert.lengthOf(await WaitingListEntry.all(), 0)
  })
})
