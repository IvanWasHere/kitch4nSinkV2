import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import User from '#models/user'
import Invitation from '#models/invitation'
import invitations, { InvitationError } from '#organizations/invitation_service'
import { seatUsage } from '#organizations/seats'
import { addMember, createWorkspace, queuedMailsTo, TEST_PASSWORD } from '#tests/helpers'

test.group('Invitations', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('the owner can invite someone', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    const response = await client
      .post('/members/invite')
      .loginAs(user)
      .form({ email: 'colleague@example.com' })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/members')

    const [queued] = await queuedMailsTo('colleague@example.com')
    assert.exists(queued, 'the invitation email is queued')
    assert.include(queued.html, '/invitations/', 'with a link that opens it')

    const invitation = await Invitation.findByOrFail('email', 'colleague@example.com')
    assert.equal(invitation.organizationId, organization.id)
    assert.equal(invitation.role, 'member')
    assert.isTrue(invitation.isPending)
    assert.match(invitation.publicId, /^inv_/)
  })

  test('stores only the hash of the invitation token', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const { invitation, token } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'colleague@example.com',
    })

    assert.notEqual(invitation.tokenHash, token)
    assert.lengthOf(invitation.tokenHash, 64)
  })

  test('a member cannot invite', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client
      .post('/members/invite')
      .loginAs(member)
      .form({ email: 'another@example.com' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(
      await Invitation.findBy('email', 'another@example.com'),
      'the policy refused before anything was written'
    )
  })

  test('accepting creates a member of that organisation', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const { token } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'colleague@example.com',
    })

    const response = await client
      .post(`/invitations/${token}/accept`)
      .form({
        fullName: 'Sam Member',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/dashboard')

    const joined = await User.findByOrFail('email', 'colleague@example.com')
    assert.equal(joined.organizationId, organization.id)
    assert.equal(joined.role, 'member')
    assert.isNotNull(joined.emailVerifiedAt, 'following the link proves the address')
  })

  test('an invitation can only be accepted once', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const { token } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'colleague@example.com',
    })

    await client
      .post(`/invitations/${token}/accept`)
      .form({
        fullName: 'Sam',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    const second = await client
      .post(`/invitations/${token}/accept`)
      .form({
        fullName: 'Someone Else',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    second.assertHeader('location', `/invitations/${token}`)
    assert.lengthOf(await User.query().where('email', 'colleague@example.com'), 1)
  })

  test('a revoked invitation stops working', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const { invitation, token } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'colleague@example.com',
    })

    await client
      .post(`/invitations/${invitation.publicId}/revoke`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await invitation.refresh()
    assert.isTrue(invitation.isRevoked)

    const response = await client.get(`/invitations/${token}`)
    response.assertTextIncludes('withdrawn')
  })

  test('an expired invitation stops working', async ({ client }) => {
    const { user, organization } = await createWorkspace()
    const { invitation, token } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'colleague@example.com',
    })

    const { DateTime } = await import('luxon')
    invitation.expiresAt = DateTime.utc().minus({ minutes: 1 })
    await invitation.save()

    const response = await client.get(`/invitations/${token}`)
    response.assertTextIncludes('expired')
  })

  /**
   * Resending must not leave the previous link working — it may have been
   * forwarded to the wrong person, which is why it is being resent.
   */
  test('resending retires the previous link', async ({ client }) => {
    const { user, organization } = await createWorkspace()
    const { invitation, token: first } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'colleague@example.com',
    })

    await client
      .post(`/invitations/${invitation.publicId}/resend`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    const response = await client.get(`/invitations/${first}`)
    response.assertTextIncludes('withdrawn')
  })

  test('refuses an address that is already a member', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    await addMember(organization, user, 'sam@example.com')

    await assert.rejects(
      () => invitations.invite({ organization, invitedBy: user, email: 'sam@example.com' }),
      InvitationError
    )
  })

  /**
   * The cost of one-organisation-per-user (D1). It has to be said out loud
   * rather than failing with a confusing "email already taken" (plan §5.4).
   */
  test('refuses an address that belongs to another workspace', async ({ client }) => {
    const { user } = await createWorkspace()
    const other = await createWorkspace({ email: 'elsewhere@example.com' })

    const response = await client
      .post('/members/invite')
      .loginAs(user)
      .form({ email: other.user.email })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage(
      'error',
      'That address already belongs to another workspace. Ask them to leave it first, or invite a different address.'
    )
  })

  test('a pending invitation holds a seat', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const before = await seatUsage(organization)
    assert.equal(before.used, 1)

    await invitations.invite({ organization, invitedBy: user, email: 'colleague@example.com' })

    const after = await seatUsage(organization)
    assert.equal(after.used, 2)
    assert.equal(after.pendingInvitations, 1)
    assert.isTrue(after.isFull, 'the free plan allows two seats')
  })

  test('revoking releases the seat it held', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const { invitation } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'colleague@example.com',
    })

    await invitations.revoke(invitation)

    const usage = await seatUsage(organization)
    assert.equal(usage.used, 1)
    assert.isFalse(usage.isFull)
  })
})
