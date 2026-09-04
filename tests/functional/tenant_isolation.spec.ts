import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import User from '#models/user'
import Invitation from '#models/invitation'
import Organization from '#models/organization'
import invitations from '#organizations/invitation_service'
import Todo from '#models/todo'
import TodoList from '#models/todo_list'
import todoService from '#todos/todo_service'
import { addMember, createList, createWorkspace } from '#tests/helpers'

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

  /*
   |--------------------------------------------------------------------------
   | Lists and todos (M3.5)
   |--------------------------------------------------------------------------
   */

  test('the lists screen shows only your own', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    await createList(a.organization, a.user, 'Belongs to A')
    await createList(b.organization, b.user, 'Belongs to B')

    const response = await client.get('/lists').loginAs(a.user)

    response.assertTextIncludes('Belongs to A')
    assert.notInclude(response.text(), 'Belongs to B')
  })

  test('opening another workspace list is a miss, not a peek', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const theirs = await createList(b.organization, b.user, 'Belongs to B', ['Secret todo'])

    const response = await client.get(`/lists/${theirs.publicId}`).loginAs(a.user).redirects(0)

    response.assertHeader('location', '/lists')
    assert.notInclude(response.text(), 'Secret todo')
  })

  test('renaming another workspace list does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const theirs = await createList(b.organization, b.user, 'Belongs to B')

    await client
      .post(`/lists/${theirs.publicId}`)
      .loginAs(a.user)
      .form({ name: 'Renamed by A' })
      .withCsrfToken()
      .redirects(0)

    await theirs.refresh()
    assert.equal(theirs.name, 'Belongs to B')
  })

  test('deleting another workspace list does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const theirs = await createList(b.organization, b.user, 'Belongs to B')

    await client
      .post(`/lists/${theirs.publicId}/delete`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    await theirs.refresh()
    assert.isFalse(theirs.isDeleted)
  })

  test('archiving another workspace list does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const theirs = await createList(b.organization, b.user, 'Belongs to B')

    await client
      .post(`/lists/${theirs.publicId}/archive`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    await theirs.refresh()
    assert.isFalse(theirs.isArchived)
  })

  test('adding a todo to another workspace list does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const theirs = await createList(b.organization, b.user, 'Belongs to B')

    await client
      .post(`/lists/${theirs.publicId}/todos`)
      .loginAs(a.user)
      .form({ title: 'Planted by A' })
      .withCsrfToken()
      .redirects(0)

    assert.isNull(await Todo.findBy('title', 'Planted by A'))
  })

  test('completing another workspace todo does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    await createList(b.organization, b.user, 'Belongs to B', ['Theirs'])
    const theirs = await Todo.findByOrFail('title', 'Theirs')

    await client
      .post(`/todos/${theirs.publicId}/complete`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    await theirs.refresh()
    assert.isFalse(theirs.isComplete)
  })

  test('deleting another workspace todo does nothing', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    await createList(b.organization, b.user, 'Belongs to B', ['Theirs'])
    const theirs = await Todo.findByOrFail('title', 'Theirs')

    await client
      .post(`/todos/${theirs.publicId}/delete`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    await theirs.refresh()
    assert.isFalse(theirs.isDeleted)
  })

  /**
   * Assigning across workspaces is the injection point plan §5.6 calls out:
   * `assigned_to` arrives in a request body.
   */
  test('a todo cannot be assigned to someone in another workspace', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    const ours = await createList(a.organization, a.user, 'Belongs to A')

    await client
      .post(`/lists/${ours.publicId}/todos`)
      .loginAs(a.user)
      .form({ title: 'Cross-tenant assignment', assignedTo: b.member.publicId })
      .withCsrfToken()
      .redirects(0)

    assert.isNull(await Todo.findBy('title', 'Cross-tenant assignment'))
  })

  /**
   * The denormalised `todos.organization_id` is what lets every todo query
   * skip the join to its list. The composite foreign key is what stops the two
   * from ever disagreeing — without it the denormalisation would be a way to
   * hide a row from its own tenant filter.
   */
  test('a todo cannot claim an organisation its list does not belong to', async ({
    assert,
    client,
  }) => {
    const { a, b } = await twoWorkspaces()
    const theirs = await createList(b.organization, b.user, 'Belongs to B')

    await assert.rejects(() =>
      Todo.create({
        organizationId: a.organization.id,
        todoListId: theirs.id,
        title: 'Smuggled',
        priority: 'normal',
        position: 100,
      })
    )

    void client
  })

  test('dashboard numbers count only your own workspace', async ({ client, assert }) => {
    const { a, b } = await twoWorkspaces()
    await createList(a.organization, a.user, 'Belongs to A', ['One'])
    await createList(b.organization, b.user, 'Belongs to B', ['One', 'Two', 'Three'])

    const { default: dashboard } = await import('#todos/dashboard_service')
    const stats = await dashboard.statsFor(a.organization)

    assert.equal(stats.lists, 1)
    assert.equal(stats.openTodos, 1)

    const response = await client.get('/dashboard').loginAs(a.user)
    assert.notInclude(response.text(), 'Belongs to B')

    void TodoList
    void todoService
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
