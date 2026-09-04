import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import User from '#models/user'
import Invitation from '#models/invitation'
import Organization from '#models/organization'
import invitations from '#organizations/invitation_service'
import { addMember, createWorkspace } from '#tests/helpers'

/**
 * Tenant isolation (plan §15).
 *
 * Two organisations, and the assertion that A can never read or mutate B —
 * endpoint by endpoint, for every endpoint that takes an identifier. This is
 * the suite that protects the product: a leak here is not a bug report, it is
 * an incident.
 *
 * Every milestone that adds an endpoint taking an id adds a case here.
 */
test.group('Tenant isolation', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  /**
   * Two complete workspaces: A with an owner and a member, B likewise.
   */
  async function twoWorkspaces() {
    const a = await createWorkspace({ email: 'owner-a@example.com', fullName: 'Owner A' })
    const b = await createWorkspace({ email: 'owner-b@example.com', fullName: 'Owner B' })

    /**
     * Room for a member and a spare invitation in each. Seat limits are their
     * own suite; here they would only get in the way of the isolation
     * assertions.
     */
    for (const workspace of [a, b]) {
      workspace.organization.limitOverrides = { seats: 5 }
      await workspace.organization.save()
    }

    const memberA = await addMember(a.organization, a.user, 'member-a@example.com', 'Member A')
    const memberB = await addMember(b.organization, b.user, 'member-b@example.com', 'Member B')

    return { a: { ...a, member: memberA }, b: { ...b, member: memberB } }
  }

  test('the members list shows only your own workspace', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()

    const response = await client.get('/members').loginAs(a.user)

    response.assertTextIncludes('member-a@example.com')
    assert.notInclude(response.text(), 'member-b@example.com')
    assert.notInclude(response.text(), b.user.email)
  })

  test('removing a member of another workspace does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()

    await client
      .post(`/members/${b.member.publicId}/remove`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    await b.member.refresh()
    assert.isFalse(b.member.isDeleted, "B's member is untouched")
  })

  test('revoking another workspace invitation does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const { invitation } = await invitations.invite({
      organization: b.organization,
      invitedBy: b.user,
      email: 'invited-b@example.com',
    })

    await client
      .post(`/invitations/${invitation.publicId}/revoke`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    await invitation.refresh()
    assert.isTrue(invitation.isPending)
  })

  test('resending another workspace invitation does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const { invitation } = await invitations.invite({
      organization: b.organization,
      invitedBy: b.user,
      email: 'invited-b@example.com',
    })

    await client
      .post(`/invitations/${invitation.publicId}/resend`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    const all = await Invitation.query().where('email', 'invited-b@example.com')
    assert.lengthOf(all, 1, 'no second invitation was issued into B')
    assert.equal(all[0].organizationId, b.organization.id)
  })

  test('transferring ownership to a stranger does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()

    await client
      .post('/settings/organization/transfer')
      .loginAs(a.user)
      .form({ memberPublicId: b.member.publicId, confirmation: a.organization.name })
      .withCsrfToken()
      .redirects(0)

    await a.organization.refresh()
    await b.member.refresh()

    assert.equal(a.organization.ownerId, a.user.id)
    assert.equal(b.member.organizationId, b.organization.id)
    assert.equal(b.member.role, 'member')
  })

  test('settings show only your own workspace', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()

    const response = await client.get('/settings/organization').loginAs(a.user)

    response.assertTextIncludes(a.organization.publicId)
    assert.notInclude(response.text(), b.organization.publicId)
  })

  /**
   * The transfer dropdown lists members to choose from; it must never offer
   * somebody from another workspace.
   */
  test('the transfer dropdown lists only your own members', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()

    const response = await client.get('/settings/organization').loginAs(a.user)

    response.assertTextIncludes(a.member.publicId)
    assert.notInclude(response.text(), b.member.publicId)
  })

  test('renaming reaches only your own workspace', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const originalB = b.organization.name

    await client
      .post('/settings/organization')
      .loginAs(a.user)
      .form({ name: 'A Renamed' })
      .withCsrfToken()
      .redirects(0)

    await a.organization.refresh()
    await b.organization.refresh()

    assert.equal(a.organization.name, 'A Renamed')
    assert.equal(b.organization.name, originalB)
  })

  test('deleting reaches only your own workspace', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()

    await client
      .post('/settings/organization/delete')
      .loginAs(a.user)
      .form({ confirmation: a.organization.name })
      .withCsrfToken()
      .redirects(0)

    await a.organization.refresh()
    await b.organization.refresh()
    await b.user.refresh()

    assert.isTrue(a.organization.isDeleted)
    assert.isFalse(b.organization.isDeleted)
    assert.isFalse(b.user.isDeleted)
  })

  /**
   * An id that does not belong to the caller must behave exactly like an id
   * that does not exist. A different response would confirm the row is real,
   * which is enough to enumerate another tenant's data.
   */
  test('a foreign id is indistinguishable from a missing one', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()

    const foreign = await client
      .post(`/members/${b.member.publicId}/remove`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    const missing = await client
      .post('/members/usr_zzzzzzzzzzzz/remove')
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    assert.equal(foreign.status(), missing.status())
    assert.deepEqual(foreign.flashMessages(), missing.flashMessages())
  })

  /**
   * The invitation link is the one credential that crosses workspaces, so it
   * must attach the joiner to the workspace that issued it and no other.
   */
  test('an invitation link joins the workspace that issued it', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()

    const { token } = await invitations.invite({
      organization: b.organization,
      invitedBy: b.user,
      email: 'joiner@example.com',
    })

    await client
      .post(`/invitations/${token}/accept`)
      .form({
        fullName: 'Joiner',
        password: 'secret-password-12',
        passwordConfirmation: 'secret-password-12',
      })
      .withCsrfToken()
      .redirects(0)

    const joiner = await User.findByOrFail('email', 'joiner@example.com')
    assert.equal(joiner.organizationId, b.organization.id)
    assert.notEqual(joiner.organizationId, a.organization.id)
  })

  test('seat counts are per workspace', async ({ assert }) => {
    const { a, b } = await twoWorkspaces()
    const { seatUsage } = await import('#organizations/seats')

    await invitations.invite({
      organization: b.organization,
      invitedBy: b.user,
      email: 'extra-b@example.com',
    })

    const usageA = await seatUsage(a.organization)
    assert.equal(usageA.members, 2)
    assert.equal(usageA.pendingInvitations, 0, "B's invitation does not count against A")
  })

  test('every organisation-scoped table carries its own rows only', async ({ assert }) => {
    const { a, b } = await twoWorkspaces()

    const usersOfA = await User.query().where('organization_id', a.organization.id)
    const usersOfB = await User.query().where('organization_id', b.organization.id)

    assert.lengthOf(usersOfA, 2)
    assert.lengthOf(usersOfB, 2)
    assert.isEmpty(
      usersOfA.filter((user) => usersOfB.some((other) => other.id === user.id)),
      'no user belongs to both'
    )

    const organizations = await Organization.all()
    assert.lengthOf(organizations, 2)
  })
})
