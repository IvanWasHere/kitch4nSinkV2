import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import memberships, { MembershipError } from '#organizations/membership_service'
import { addMember, createWorkspace } from '#tests/helpers'

test.group('Ownership transfer', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('moves the owner role and the organisation pointer together', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client
      .post('/settings/organization/transfer')
      .loginAs(user)
      .form({ memberPublicId: member.publicId, confirmation: organization.name })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/settings/organization')

    await organization.refresh()
    await user.refresh()
    await member.refresh()

    assert.equal(organization.ownerId, member.id)
    assert.equal(member.role, 'owner')
    assert.equal(user.role, 'member', 'there is exactly one owner')
  })

  test('needs the workspace name typed exactly', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    await client
      .post('/settings/organization/transfer')
      .loginAs(user)
      .form({ memberPublicId: member.publicId, confirmation: 'not the name' })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.equal(organization.ownerId, user.id)
  })

  test('a member cannot transfer ownership to themselves', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    await client
      .post('/settings/organization/transfer')
      .loginAs(member)
      .form({ memberPublicId: member.publicId, confirmation: organization.name })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.equal(organization.ownerId, user.id)
  })

  test('refuses someone who is not in the workspace', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const outsider = await createWorkspace({ email: 'outsider@example.com' })

    await assert.rejects(
      () => memberships.transferOwnership(organization, user, outsider.user),
      MembershipError
    )
  })

  test('the new owner can then do owner-only things', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    await memberships.transferOwnership(organization, user, member)
    await member.refresh()
    await user.refresh()

    const allowed = await client
      .post('/settings/organization')
      .loginAs(member)
      .form({ name: 'Renamed By New Owner' })
      .withCsrfToken()
      .redirects(0)
    allowed.assertHeader('location', '/settings/organization')

    await organization.refresh()
    assert.equal(organization.name, 'Renamed By New Owner')

    /**
     * And the previous owner cannot: the demotion is real, not cosmetic.
     */
    await client
      .post('/settings/organization')
      .loginAs(user)
      .form({ name: 'Renamed By Old Owner' })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.equal(organization.name, 'Renamed By New Owner')
  })
})
