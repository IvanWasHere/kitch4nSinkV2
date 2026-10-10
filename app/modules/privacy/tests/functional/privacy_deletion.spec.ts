import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import drive from '@adonisjs/drive/services/main'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import File from '#models/file'
import User from '#models/user'
import Payment from '#models/payment'
import AuditLog from '#models/audit_log'
import AuthToken from '#models/auth_token'
import Invitation from '#models/invitation'
import Organization from '#models/organization'
import Subscription from '#models/subscription'
import SocialAccount from '#models/social_account'
import authTokens from '#auth/auth_token_service'
import invitations from '#organizations/invitation_service'
import deletion from '#modules/privacy/services/deletion_service'
import PrivacyRequest from '#modules/privacy/models/privacy_request'
import { IMPERSONATION_SESSION_KEY } from '#middleware/impersonation'
import {
  addMember,
  createStaff,
  createWorkspace,
  queuedMails,
  queuedMailsTo,
  runQueue,
  TEST_PASSWORD,
} from '#tests/helpers'

/**
 * Account deletion (plan §22.8.2, D14).
 */

const ask = (client: any, user: User, form: Record<string, string> = {}) =>
  client
    .post('/settings/privacy/deletion')
    .loginAs(user)
    .form({ password: TEST_PASSWORD, understood: '1', ...form })
    .withCsrfToken()
    .redirects(0)

async function approveAndRun(client: any, request: PrivacyRequest) {
  const admin = await createStaff({ role: 'admin' })
  const response = await client
    .post(`/admin/privacy/${request.publicId}/approve`)
    .withGuard('staff')
    .loginAs(admin)
    .withCsrfToken()
    .redirects(0)

  await runQueue('default')
  await request.refresh()
  return response
}

async function confirmedRequestFor(client: any, user: User) {
  await ask(client, user)
  return PrivacyRequest.query().where('user_id', user.id).where('type', 'deletion').firstOrFail()
}

async function storedFile(
  organization: Organization,
  user: User,
  key: string,
  attachTo?: { type: 'User' | 'Organization'; id: number }
) {
  await drive.use('private').put(key, 'bytes')
  return File.create({
    organizationId: organization.id,
    userId: user.id,
    disk: 'private',
    key,
    originalName: key.split('/').pop()!,
    mimeType: 'text/plain',
    sizeBytes: 5,
    visibility: 'private',
    checksum: 'x',
    attachableType: attachTo?.type ?? null,
    attachableId: attachTo?.id ?? null,
  })
}

test.group('Privacy — asking to be deleted', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  test('the screen explains what deletion does before asking', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/settings/privacy').loginAs(user)

    response.assertTextIncludes('Delete my account')
    response.assertTextIncludes('Our team reviews every request')
    response.assertTextIncludes('Payment records and the security log are kept')
  })

  test('the right password confirms the request on the spot', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    const response = await ask(client, user)

    response.assertHeader('location', '/settings/privacy')
    const request = await PrivacyRequest.findByOrFail('user_id', user.id)
    assert.equal(request.type, 'deletion')
    assert.equal(request.status, 'confirmed')
    assert.isNotNull(request.confirmedAt)
    assert.exists(await AuditLog.findBy('action', 'privacy.deletion.confirmed'))
  })

  test('a wrong password, or no tick, creates nothing', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    const wrong = await ask(client, user, { password: 'not-the-password' })
    wrong.assertFlashMessage('error', 'That password is not right.')

    await client
      .post('/settings/privacy/deletion')
      .loginAs(user)
      .form({ password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    assert.lengthOf(await PrivacyRequest.all(), 0)
  })

  test('asking twice returns the request already in progress', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    await ask(client, user)
    await ask(client, user)

    assert.lengthOf(await PrivacyRequest.query().where('type', 'deletion'), 1)
  })

  test('an owner with members is told who goes with them, and can still ask', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    await addMember(organization, user, 'sam@example.com')

    const page = await client.get('/settings/privacy').loginAs(user)
    page.assertTextIncludes('You own this workspace, so it is deleted with you')
    assert.match(page.text(), /1 other person is\s+in this\s+workspace/)

    await ask(client, user)
    assert.lengthOf(await PrivacyRequest.query().where('type', 'deletion'), 1)
  })

  test('without a password, an emailed link confirms it', async ({ client, assert }) => {
    const { user } = await createWorkspace({ email: 'social@example.com' })
    user.password = null
    await user.save()

    const response = await ask(client, user, { password: '' })
    response.assertFlashMessage(
      'success',
      'Check your email and follow the link to confirm. Nothing happens until you do.'
    )

    const request = await PrivacyRequest.findByOrFail('user_id', user.id)
    assert.equal(request.status, 'requested')
    assert.lengthOf(request.confirmationTokenHash!, 64)

    const [sent] = await queuedMailsTo('social@example.com')
    assert.equal(sent.subject, 'Confirm your account deletion request')
    const path = sent.text.match(/\/privacy\/deletion\/confirm\/[A-Za-z0-9_-]+/)![0]
    assert.notInclude(request.confirmationTokenHash!, path.split('/').pop()!)

    const first = await client.get(path)
    first.assertTextIncludes('Confirmed.')
    await request.refresh()
    assert.equal(request.status, 'confirmed')
    assert.isNull(request.confirmationTokenHash, 'single use')

    const again = await client.get(path)
    again.assertTextIncludes('That link is not valid')
  })

  test('an expired or made-up link confirms nothing', async ({ client, assert }) => {
    const { user } = await createWorkspace({ email: 'social@example.com' })
    user.password = null
    await user.save()
    await ask(client, user, { password: '' })

    const request = await PrivacyRequest.findByOrFail('user_id', user.id)
    request.confirmationExpiresAt = DateTime.utc().minus({ minutes: 1 })
    await request.save()

    const [sent] = await queuedMailsTo('social@example.com')
    const path = sent.text.match(/\/privacy\/deletion\/confirm\/[A-Za-z0-9_-]+/)![0]

    const expired = await client.get(path)
    expired.assertTextIncludes('That link has expired')

    const madeUp = await client.get('/privacy/deletion/confirm/nonsense')
    madeUp.assertTextIncludes('That link is not valid')

    await request.refresh()
    assert.equal(request.status, 'requested')
  })

  test('it can be cancelled before approval, and not after', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const request = await confirmedRequestFor(client, user)

    const cancel = await client
      .post('/settings/privacy/deletion/cancel')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)
    cancel.assertFlashMessage(
      'success',
      'Your deletion request has been cancelled. Your account is unchanged.'
    )
    await request.refresh()
    assert.equal(request.status, 'cancelled')

    const second = await confirmedRequestFor(client, user).then(async () =>
      PrivacyRequest.query().where('status', 'confirmed').firstOrFail()
    )
    second.status = 'approved'
    await second.save()

    await assert.rejects(() => deletion.cancel(second), /can no longer be cancelled/)
  })

  test('an impersonating admin cannot ask on the person’s behalf', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    const { user } = await createWorkspace()

    const started = await client
      .post(`/admin/users/${user.publicId}/impersonate`)
      .withGuard('staff')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    assert.exists(started.session()[IMPERSONATION_SESSION_KEY])

    const response = await client
      .post('/settings/privacy/deletion')
      .withSession(started.session())
      .form({ password: TEST_PASSWORD, understood: '1' })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage(
      'error',
      'Only the person an account belongs to can ask for it to be deleted.'
    )
    assert.lengthOf(await PrivacyRequest.all(), 0)
  })
})

test.group('Privacy — reviewing a deletion', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  test('support can see it but neither approve nor reject', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const request = await confirmedRequestFor(client, user)
    const support = await createStaff({ role: 'support' })

    const page = await client
      .get(`/admin/privacy/${request.publicId}`)
      .withGuard('staff')
      .loginAs(support)
    page.assertStatus(200)
    page.assertTextIncludes('Only an admin can approve or reject a deletion.')

    for (const action of ['approve', 'reject']) {
      await client
        .post(`/admin/privacy/${request.publicId}/${action}`)
        .withGuard('staff')
        .loginAs(support)
        .form({ reason: 'Because I said so' })
        .withCsrfToken()
        .redirects(0)
    }

    await request.refresh()
    assert.equal(request.status, 'confirmed')
  })

  test('the review warns about the last member and an active subscription', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    await Subscription.create({
      organizationId: organization.id,
      provider: 'creem',
      providerSubscriptionId: 'sub_1',
      providerCustomerId: 'cus_1',
      planKey: 'pro',
      status: 'active',
      currentPeriodStart: DateTime.utc(),
      currentPeriodEnd: DateTime.utc().plus({ months: 1 }),
      cancelAtPeriodEnd: false,
    })
    const request = await confirmedRequestFor(client, user)
    const admin = await createStaff({ role: 'admin' })

    const page = await client
      .get(`/admin/privacy/${request.publicId}`)
      .withGuard('staff')
      .loginAs(admin)

    page.assertTextIncludes('They are the last member of their workspace')
    assert.match(page.text(), /keeps\s+charging until it is cancelled/)
    page.assertTextIncludes('Delete account')
  })

  test('the review says who else an owner takes with them', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const request = await confirmedRequestFor(client, user)
    await addMember(organization, user, 'sam@example.com')
    const admin = await createStaff({ role: 'admin' })

    const page = await client
      .get(`/admin/privacy/${request.publicId}`)
      .withGuard('staff')
      .loginAs(admin)

    assert.match(page.text(), /1 other\s+person is in it/)
    page.assertTextIncludes('Every other member of the workspace is deleted the same way')
    page.assertTextIncludes('Delete account and workspace')

    const list = await client.get('/admin/privacy').withGuard('staff').loginAs(admin)
    assert.include(list.text(), 'dropdown-item-danger')
    const support = await createStaff({ role: 'support' })
    const asSupport = await client.get('/admin/privacy').withGuard('staff').loginAs(support)
    assert.notInclude(asSupport.text(), 'dropdown-item-danger')
    asSupport.assertTextIncludes('View request')
  })

  test('rejecting needs a reason, and emails it', async ({ client, assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const request = await confirmedRequestFor(client, user)
    const admin = await createStaff({ role: 'admin' })

    await client
      .post(`/admin/privacy/${request.publicId}/reject`)
      .withGuard('staff')
      .loginAs(admin)
      .form({ reason: 'An open invoice dispute needs this account until it is resolved.' })
      .withCsrfToken()
      .redirects(0)

    await request.refresh()
    assert.equal(request.status, 'rejected')
    assert.equal(
      request.rejectionReason,
      'An open invoice dispute needs this account until it is resolved.'
    )

    const mails = await queuedMailsTo('jane@example.com')
    const sent = mails.find((one) => one.subject === 'About your account deletion request')
    assert.include(sent!.text, 'An open invoice dispute')
    assert.exists(await AuditLog.findBy('action', 'privacy.deletion.rejected'))
  })
})

test.group('Privacy — the deletion itself', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  test('approving deletes the account there and then, without a worker', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const request = await confirmedRequestFor(client, user)
    const admin = await createStaff({ role: 'admin' })

    const response = await client
      .post(`/admin/privacy/${request.publicId}/approve`)
      .withGuard('staff')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('success', 'The account has been deleted.')
    await request.refresh()
    assert.equal(request.status, 'completed')

    const login = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    login.assertHeader('location', '/login')

    /**
     * The job queued as the safety net finds nothing left to do.
     */
    await runQueue('default')
    await request.refresh()
    assert.equal(request.status, 'completed')
  })

  test('the profile row is kept with generic details, and cannot sign in', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    user.twoFactorSecret = 'PLANTED'
    user.twoFactorConfirmedAt = DateTime.utc()
    await user.save()
    const request = await confirmedRequestFor(client, user)

    await approveAndRun(client, request)

    assert.equal(request.status, 'completed')
    const row = await User.findOrFail(user.id)
    assert.equal(row.email, `email${user.id}@deleteduser.com`)
    assert.equal(row.fullName, 'Deleted User', 'the row stays, with a generic name')
    assert.isNull(row.lastLoginAt)
    assert.equal(row.role, 'owner')
    assert.isNull(row.password)
    assert.isNull(row.twoFactorSecret)
    assert.isNull(row.twoFactorConfirmedAt)
    assert.isNotNull(row.deletedAt)

    const login = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    login.assertHeader('location', '/login')
  })

  test('credentials go, billing stays exactly as it was', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace({ email: 'jane@example.com' })
    await SocialAccount.create({
      userId: user.id,
      provider: 'github',
      providerUserId: '42',
      providerEmail: user.email,
      accessToken: 'token',
    })
    await authTokens.issue(user, 'reset_password')
    const subscription = await Subscription.create({
      organizationId: organization.id,
      provider: 'creem',
      providerSubscriptionId: 'sub_1',
      providerCustomerId: 'cus_1',
      planKey: 'pro',
      status: 'active',
      currentPeriodStart: DateTime.utc(),
      currentPeriodEnd: DateTime.utc().plus({ months: 1 }),
      cancelAtPeriodEnd: false,
    })
    const payment = await Payment.create({
      organizationId: organization.id,
      subscriptionId: subscription.id,
      provider: 'creem',
      providerOrderId: 'ord_1',
      amountCents: 2900,
      currency: 'USD',
      status: 'succeeded',
      refundedAmountCents: 0,
      description: 'Pro plan',
      occurredAt: DateTime.utc(),
    })
    await subscription.refresh()
    await payment.refresh()
    const billingBefore = JSON.stringify([subscription.serialize(), payment.serialize()])

    await approveAndRun(client, await confirmedRequestFor(client, user))

    assert.lengthOf(await SocialAccount.query().where('user_id', user.id), 0)
    assert.lengthOf(await AuthToken.query().where('user_id', user.id), 0)

    await subscription.refresh()
    await payment.refresh()
    assert.equal(JSON.stringify([subscription.serialize(), payment.serialize()]), billingBefore)
    assert.exists(await Organization.find(organization.id), 'the workspace row stays')
  })

  /**
   * What each feature does with its own rows — lists and todos, the waiting
   * list — is that module's contract, tested in that module against its own
   * contributor. These cases cover what core and this module own.
   */
  test('with other members, their uploads stay and only the avatar goes', async ({
    client,
    assert,
  }) => {
    const { user: owner, organization } = await createWorkspace()
    const member = await addMember(organization, owner, 'sam@example.com')

    const avatar = await storedFile(organization, member, 'test/avatar.png', {
      type: 'User',
      id: member.id,
    })
    const upload = await storedFile(organization, member, 'test/report.txt')

    await approveAndRun(client, await confirmedRequestFor(client, member))

    const entry = await AuditLog.findByOrFail('action', 'privacy.deletion.completed')
    assert.include(entry.metadata!, { lastMember: false })

    assert.isNull(await File.find(avatar.id))
    assert.isFalse(await drive.use('private').exists('test/avatar.png'))
    assert.exists(await File.find(upload.id))
    assert.isTrue(await drive.use('private').exists('test/report.txt'))
  })

  test('deleting an owner deletes the workspace and everybody in it', async ({
    client,
    assert,
  }) => {
    const { user: owner, organization } = await createWorkspace({ email: 'jane@example.com' })
    const sam = await addMember(organization, owner, 'sam@example.com')
    const { user: stranger } = await createWorkspace({ email: 'else@example.com' })

    const upload = await storedFile(organization, sam, 'test/sams-report.txt')
    const samsOwn = await confirmedRequestFor(client, sam)

    const request = await confirmedRequestFor(client, owner)
    await approveAndRun(client, request)

    assert.equal(request.status, 'completed')

    for (const person of [owner, sam]) {
      const row = await User.findOrFail(person.id)
      assert.equal(row.email, `email${person.id}@deleteduser.com`)
      assert.equal(row.fullName, 'Deleted User')
      assert.isNull(row.password)
      assert.isNotNull(row.deletedAt)
    }

    const untouched = await User.findOrFail(stranger.id)
    assert.equal(untouched.email, 'else@example.com')
    assert.isNull(untouched.deletedAt)

    assert.isNull(await File.find(upload.id), 'the workspace files go')
    assert.isFalse(await drive.use('private').exists('test/sams-report.txt'))
    assert.exists(await Organization.find(organization.id), 'the workspace row stays for billing')

    const entry = await AuditLog.findByOrFail('action', 'privacy.deletion.completed')
    assert.include(entry.metadata!, { lastMember: true, membersDeleted: 1 })

    await samsOwn.refresh()
    assert.equal(samsOwn.status, 'completed', 'their own request was honoured by this one')
    assert.isNotNull(samsOwn.completedAt)

    const toOwner = await queuedMailsTo('jane@example.com')
    assert.isTrue(toOwner.some((one) => one.subject === 'Your account has been deleted'))
    const toSam = await queuedMailsTo('sam@example.com')
    assert.isTrue(toSam.some((one) => one.subject === 'Your account has been deleted'))

    const login = await client
      .post('/login')
      .form({ email: 'sam@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    login.assertHeader('location', '/login')
  })

  test('deleting a member leaves the workspace and its owner alone', async ({ client, assert }) => {
    const { user: owner, organization } = await createWorkspace({ email: 'jane@example.com' })
    const sam = await addMember(organization, owner, 'sam@example.com')

    await approveAndRun(client, await confirmedRequestFor(client, sam))

    const row = await User.findOrFail(owner.id)
    assert.equal(row.email, 'jane@example.com')
    assert.isNull(row.deletedAt)
    const entry = await AuditLog.findByOrFail('action', 'privacy.deletion.completed')
    assert.include(entry.metadata!, { lastMember: false, membersDeleted: 0 })
  })

  test('as the last member, every file in the workspace goes too', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace({ email: 'jane@example.com' })
    const upload = await storedFile(organization, user, 'test/notes.txt')

    await approveAndRun(client, await confirmedRequestFor(client, user))

    assert.isNull(await File.find(upload.id))
    assert.isFalse(await drive.use('private').exists('test/notes.txt'))

    const entry = await AuditLog.findByOrFail('action', 'privacy.deletion.completed')
    assert.include(entry.metadata!, { lastMember: true })
  })

  test('pending invitations go; the audit trail stays without IP addresses', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    await invitations.invite({ organization, invitedBy: user, email: 'friend@example.com' })
    await AuditLog.create({
      organizationId: organization.id,
      actorType: 'user',
      actorId: user.id,
      action: 'privacy.export.requested',
      ip: '203.0.113.7',
      userAgent: 'Planted browser',
      createdAt: DateTime.utc(),
    })

    await approveAndRun(client, await confirmedRequestFor(client, user))

    assert.lengthOf(await Invitation.query().where('invited_by_user_id', user.id), 0)

    const entries = await AuditLog.query().where('actor_type', 'user').where('actor_id', user.id)
    assert.isNotEmpty(entries, 'the security record stays')
    assert.isTrue(entries.every((entry) => entry.ip === null && entry.userAgent === null))
  })

  test('a goodbye email goes to the old address, which is then forgotten', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const request = await confirmedRequestFor(client, user)

    await approveAndRun(client, request)

    const mails = await queuedMailsTo('jane@example.com')
    const sent = mails.find((one) => one.subject === 'Your account has been deleted')
    assert.exists(sent)
    assert.isNull(request.notificationEmail)
  })

  test('nothing is ever emailed to the overwritten address', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    await approveAndRun(client, await confirmedRequestFor(client, user))
    const row = await User.findOrFail(user.id)
    const { length: before } = await queuedMails()

    const token = await authTokens.issue(row, 'verify_email')
    const { default: mailer } = await import('#mail/mailer_service')
    const { default: VerifyEmailNotification } =
      await import('#mail/mails/verify_email_notification')
    const queued = await mailer.send(new VerifyEmailNotification(row, token))

    assert.isNull(queued)
    assert.lengthOf(await queuedMails(), before)
  })

  test('running it twice changes nothing more', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const request = await confirmedRequestFor(client, user)
    await approveAndRun(client, request)
    const completedAt = request.completedAt!.toMillis()

    request.status = 'processing'
    await request.save()
    await deletion.process(request.id, false)

    await request.refresh()
    const row = await User.findOrFail(user.id)
    assert.equal(row.email, `email${user.id}@deleteduser.com`)
    assert.equal(request.status, 'completed')
    assert.isAtLeast(request.completedAt!.toMillis(), completedAt)
  })

  test('a failed deletion can be retried by an admin', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const request = await confirmedRequestFor(client, user)
    request.merge({ status: 'failed', failureReason: 'boom' })
    await request.save()
    const admin = await createStaff({ role: 'admin' })

    await client
      .post(`/admin/privacy/${request.publicId}/retry`)
      .withGuard('staff')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    await runQueue('default')

    await request.refresh()
    assert.equal(request.status, 'completed')
    assert.exists(await AuditLog.findBy('action', 'privacy.deletion.retried'))
  })
})
