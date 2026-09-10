import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import File from '#models/file'
import SupportTicket from '#models/support_ticket'
import SupportMessage from '#models/support_message'
import support from '#support/support_service'
import {
  addMember,
  clearStorage,
  createStaff,
  createWorkspace,
  fixtureUpload,
  queuedMailsTo,
} from '#tests/helpers'

/**
 * Support tickets (plan §21).
 *
 * Three things are load-bearing here and each gets its own group: who may
 * read a conversation (§21.4), the status machine including reopen-by-reply
 * (§21.2), and attachments — which are the one part of this feature that puts
 * customer bytes behind a URL (§21.3).
 */
test.group('Support — opening and reading', (group) => {
  group.each.setup(() => {
    mail.fake()
    return async () => {
      mail.restore()
      await testUtils.db().truncate()
    }
  })

  test('a member opens a ticket and lands on the conversation', async ({ client, assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })

    const response = await client
      .post('/support')
      .loginAs(user)
      .withCsrfToken()
      .form({ subject: 'Uploads time out', body: 'Every file over 10 MB fails at 90%.' })
      .redirects(0)

    const ticket = await SupportTicket.firstOrFail()

    response.assertStatus(302)
    response.assertHeader('location', `/support/${ticket.publicId}`)

    assert.equal(ticket.status, 'open', 'a new ticket is waiting on us')
    assert.equal(ticket.subject, 'Uploads time out')
    assert.isNull(ticket.firstRespondedAt)

    const messages = await SupportMessage.query().where('support_ticket_id', ticket.id)
    assert.lengthOf(messages, 1)
    assert.equal(messages[0].authorType, 'user')
    assert.equal(messages[0].authorUserId, user.id)
    assert.isNull(messages[0].authorStaffId, 'exactly one author column is set')
  })

  test('an empty body is refused', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    const response = await client
      .post('/support')
      .loginAs(user)
      .withCsrfToken()
      .form({ subject: 'Something', body: '   ' })
      .redirects(0)

    response.assertStatus(302)
    assert.lengthOf(await SupportTicket.all(), 0, 'nothing is opened without a message')
  })

  /**
   * §21.4. A ticket can carry a billing dispute or a complaint about a
   * colleague, so it is narrower than the workspace-wide rule lists follow.
   */
  test('a member sees their own tickets, an owner sees the workspace', async ({
    client,
    assert,
  }) => {
    const { user: owner, organization } = await createWorkspace({ email: 'owner@example.com' })
    organization.limitOverrides = { seats: 5 }
    await organization.save()

    const member = await addMember(organization, owner, 'member@example.com', 'Member')

    await support.open(organization, member, { subject: 'Member question', body: 'Mine.' })
    await support.open(organization, owner, { subject: 'Owner question', body: 'Theirs.' })

    const asMember = await client.get('/support').loginAs(member)
    asMember.assertTextIncludes('Member question')
    assert.notInclude(asMember.text(), 'Owner question')

    const asOwner = await client.get('/support').loginAs(owner)
    asOwner.assertTextIncludes('Member question')
    asOwner.assertTextIncludes('Owner question')
  })

  test('a colleague cannot open a ticket that is not theirs', async ({ client, assert }) => {
    const { user: owner, organization } = await createWorkspace({ email: 'owner@example.com' })
    organization.limitOverrides = { seats: 5 }
    await organization.save()

    const one = await addMember(organization, owner, 'one@example.com', 'One')
    const two = await addMember(organization, owner, 'two@example.com', 'Two')

    const { ticket } = await support.open(organization, one, {
      subject: 'Private matter',
      body: 'Just for support.',
    })

    const response = await client.get(`/support/${ticket.publicId}`).loginAs(two).redirects(0)

    response.assertStatus(302)
    assert.notInclude(response.text(), 'Private matter')
  })
})

test.group('Support — the status machine', (group) => {
  group.each.setup(() => {
    mail.fake()
    return async () => {
      mail.restore()
      await testUtils.db().truncate()
    }
  })

  test('staff replying answers it, and stamps the first response once', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const staff = await createStaff({ role: 'support' })

    const { ticket } = await support.open(organization, user, {
      subject: 'Question',
      body: 'First.',
    })

    await support.replyAsStaff(ticket, staff, 'An answer.')
    assert.equal(ticket.status, 'answered')
    assert.isNotNull(ticket.firstRespondedAt)

    const firstResponse = ticket.firstRespondedAt

    await support.replyAsStaff(ticket, staff, 'And another.')
    assert.equal(
      ticket.firstRespondedAt?.toISO(),
      firstResponse?.toISO(),
      'the first answer is a fact about the first answer'
    )
  })

  test('the customer replying puts it back on us', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const staff = await createStaff({ role: 'support' })

    const { ticket } = await support.open(organization, user, { subject: 'Q', body: 'First.' })
    await support.replyAsStaff(ticket, staff, 'An answer.')
    await support.replyAsUser(ticket, user, 'Thanks, but…')

    assert.equal(ticket.status, 'open')
  })

  /**
   * There is no `closed`: replying to a resolved ticket reopens it, because
   * that is what people do instead of opening a second one (§21.2).
   */
  test('a reply reopens a resolved ticket', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const { ticket } = await support.open(organization, user, { subject: 'Q', body: 'First.' })
    await support.resolve(ticket)
    assert.equal(ticket.status, 'resolved')
    assert.isNotNull(ticket.resolvedAt)

    await support.replyAsUser(ticket, user, 'It is happening again.')

    assert.equal(ticket.status, 'open')
    assert.isNull(ticket.resolvedAt)
  })

  test('the account menu counts tickets waiting on the customer', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const staff = await createStaff({ role: 'support' })

    const { ticket } = await support.open(organization, user, { subject: 'Q', body: 'First.' })
    assert.equal(await support.awaitingCustomerCount(organization, user), 0)

    await support.replyAsStaff(ticket, staff, 'An answer.')
    assert.equal(await support.awaitingCustomerCount(organization, user), 1)

    await support.replyAsUser(ticket, user, 'Thanks.')
    assert.equal(await support.awaitingCustomerCount(organization, user), 0)
  })
})

test.group('Support — the back office', (group) => {
  group.each.setup(() => {
    mail.fake()
    return async () => {
      mail.restore()
      await testUtils.db().truncate()
    }
  })

  /**
   * §21.6 — the one back-office write surface open to support as well as
   * admin, because answering customers is the support role's whole job.
   */
  test('support can reply, and the customer is emailed', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace({ email: 'jane@example.com' })
    const staff = await createStaff({ role: 'support' })
    const { ticket } = await support.open(organization, user, { subject: 'Q', body: 'First.' })

    const response = await client
      .post(`/admin/support/${ticket.publicId}/replies`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .form({ body: 'Here is the answer.' })
      .redirects(0)

    response.assertStatus(302)

    await ticket.refresh()
    assert.equal(ticket.status, 'answered')

    /**
     * Queued, not sent inline — mail goes through the queue like every other
     * message the application sends (plan §8).
     */
    const queued = await queuedMailsTo('jane@example.com')
    assert.lengthOf(queued, 1)
    assert.include(queued[0].subject, 'Q')
    assert.include(queued[0].text, 'Here is the answer.')
  })

  test('a disabled staff account cannot reply', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const staff = await createStaff({ role: 'support', disabled: true })
    const { ticket } = await support.open(organization, user, { subject: 'Q', body: 'First.' })

    await client
      .post(`/admin/support/${ticket.publicId}/replies`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .form({ body: 'Nope.' })
      .redirects(0)

    const messages = await SupportMessage.query().where('support_ticket_id', ticket.id)
    assert.lengthOf(messages, 1, 'only the customer’s message')
  })

  test('a tenant user cannot reach the queue', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/admin/support').loginAs(user).redirects(0)

    response.assertStatus(302)
  })
})

test.group('Support — attachments', (group) => {
  group.each.setup(() => {
    mail.fake()
    return async () => {
      mail.restore()
      await clearStorage()
      await testUtils.db().truncate()
    }
  })

  test('an image is stored privately against the message', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const upload = await fixtureUpload('png', { clientName: 'screenshot.png' })

    await client
      .post('/support')
      .loginAs(user)
      .withCsrfToken()
      .fields({ subject: 'Broken layout', body: 'See the screenshot.' })
      .file('attachments', upload.tmpPath, { filename: 'screenshot.png' })
      .redirects(0)

    const file = await File.firstOrFail()
    const message = await SupportMessage.firstOrFail()

    assert.equal(file.attachableType, 'SupportMessage')
    assert.equal(file.attachableId, message.id)
    assert.equal(file.disk, 'private', 'a support screenshot is never public')
    assert.equal(file.organizationId, organization.id)
  })

  /**
   * §21.3 — otherwise a customer at their limit cannot attach a screenshot to
   * the ticket they are opening about being at their limit.
   */
  test('the storage cap does not block an attachment, but the bytes still count', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()

    organization.storageUsedBytes = 999_999_999
    await organization.save()

    const upload = await fixtureUpload('png', { clientName: 'screenshot.png' })

    await client
      .post('/support')
      .loginAs(user)
      .withCsrfToken()
      .fields({ subject: 'At my limit', body: 'Here is what I see.' })
      .file('attachments', upload.tmpPath, { filename: 'screenshot.png' })
      .redirects(0)

    const file = await File.first()
    assert.isNotNull(file, 'the attachment was accepted')

    await organization.refresh()
    assert.isAbove(
      organization.storageUsedBytes,
      999_999_999,
      'the meter still counts what was stored'
    )
  })

  test('an executable wearing an image extension is refused', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const upload = await fixtureUpload('html', { clientName: 'screenshot.png' })

    await client
      .post('/support')
      .loginAs(user)
      .withCsrfToken()
      .fields({ subject: 'Nice try', body: 'A payload.' })
      .file('attachments', upload.tmpPath, { filename: 'screenshot.png' })
      .redirects(0)

    assert.lengthOf(await File.all(), 0)
  })
})
