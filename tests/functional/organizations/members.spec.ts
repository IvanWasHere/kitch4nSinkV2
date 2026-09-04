import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import User from '#models/user'
import Organization from '#models/organization'
import memberships, { MembershipError } from '#organizations/membership_service'
import { seatUsage } from '#organizations/seats'
import { addMember, createWorkspace } from '#tests/helpers'

test.group('Members', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('every member can see the team', async ({ client }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com', 'Sam Member')

    const response = await client.get('/members').loginAs(member)

    response.assertStatus(200)
    response.assertTextIncludes('Sam Member')
    response.assertTextIncludes(user.email)
  })

  test('the owner can remove a member', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client
      .post(`/members/${member.publicId}/remove`)
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/members')

    await member.refresh()
    assert.isTrue(member.isDeleted, 'removal is a soft delete — shared work survives')

    const usage = await seatUsage(organization)
    assert.equal(usage.members, 1, 'the seat is released')
  })

  test('a member cannot remove anyone', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    /**
     * Free allows two seats; a staff limit override (plan §7.4) makes room
     * for a third so the test is about permissions, not about the cap.
     */
    organization.limitOverrides = { seats: 5 }
    await organization.save()

    const member = await addMember(organization, user, 'sam@example.com')
    const other = await addMember(organization, user, 'alex@example.com')

    await client
      .post(`/members/${other.publicId}/remove`)
      .loginAs(member)
      .withCsrfToken()
      .redirects(0)

    await other.refresh()
    assert.isFalse(other.isDeleted)
  })

  /**
   * Removing the owner would leave the workspace with nobody who can pay for
   * it, invite anyone, or delete it.
   */
  test('the owner cannot be removed', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    await assert.rejects(() => memberships.remove(organization, user), MembershipError)
  })

  test('a member can leave', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client
      .post('/settings/organization/leave')
      .loginAs(member)
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/login')

    await member.refresh()
    assert.isTrue(member.isDeleted)
  })

  test('the owner cannot leave', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    const response = await client
      .post('/settings/organization/leave')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await user.refresh()
    assert.isFalse(user.isDeleted)
    await organization.refresh()
    assert.equal(organization.ownerId, user.id)
  })

  test('a removed member cannot sign back in to the workspace', async ({ client }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')
    await memberships.remove(organization, member)

    const response = await client
      .post('/login')
      .form({ email: 'sam@example.com', password: 'secret-password-12' })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'Those credentials do not match our records.')
  })

  test('a member freed by removal can be re-invited', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    let usage = await seatUsage(organization)
    assert.isTrue(usage.isFull)

    await memberships.remove(organization, member)

    usage = await seatUsage(organization)
    assert.isFalse(usage.isFull)

    const rejoined = await addMember(organization, user, 'sam2@example.com')
    assert.equal(rejoined.organizationId, organization.id)
  })

  test('deleting the workspace removes access for everyone', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client
      .post('/settings/organization/delete')
      .loginAs(user)
      .form({ confirmation: organization.name })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/')

    await organization.refresh()
    await user.refresh()
    await member.refresh()

    assert.isTrue(organization.isDeleted)
    assert.isTrue(user.isDeleted)
    assert.isTrue(member.isDeleted)

    /**
     * Soft, not erased (D9). Whether deleted workspaces are eventually purged
     * is plan §19 Q2, still open.
     */
    assert.isNotNull(await Organization.find(organization.id))
    assert.isNotNull(await User.find(member.id))
  })

  test('deleting needs the workspace name typed exactly', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    await client
      .post('/settings/organization/delete')
      .loginAs(user)
      .form({ confirmation: 'something else' })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.isFalse(organization.isDeleted)
  })

  test('a member cannot delete the workspace', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    await client
      .post('/settings/organization/delete')
      .loginAs(member)
      .form({ confirmation: organization.name })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.isFalse(organization.isDeleted)
  })
})
