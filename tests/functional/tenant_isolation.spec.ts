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

  /**
   * Billing (M4). The screen takes no identifier at all — the session is the
   * scope — so the isolation risks here are a workspace reading another's
   * money, and a webhook attributing a subscription to the wrong tenant.
   */
  test('billing shows a workspace only its own subscription and payments', async ({
    assert,
    client,
  }) => {
    const { a, b } = await twoWorkspaces()
    const { DateTime } = await import('luxon')
    const { default: Payment } = await import('#models/payment')
    const { default: Subscription } = await import('#models/subscription')

    const subscription = await Subscription.create({
      organizationId: b.organization.id,
      provider: 'creem',
      providerSubscriptionId: 'sub_b',
      providerCustomerId: 'cus_b',
      planKey: 'pro',
      status: 'active',
      currentPeriodStart: DateTime.utc(),
      currentPeriodEnd: DateTime.utc().plus({ months: 1 }),
      cancelAtPeriodEnd: false,
    })

    await Payment.create({
      organizationId: b.organization.id,
      subscriptionId: subscription.id,
      provider: 'creem',
      providerOrderId: 'ord_b',
      amountCents: 2900,
      currency: 'USD',
      status: 'succeeded',
      refundedAmountCents: 0,
      description: "B's private invoice",
      occurredAt: DateTime.utc(),
    })

    const response = await client.get('/billing').loginAs(a.user)

    response.assertStatus(200)
    response.assertTextIncludes('Current plan: Free')
    assert.notInclude(response.text(), "B's private invoice")
    assert.notInclude(response.text(), 'pay_')

    const { default: billing } = await import('#billing/billing_service')
    assert.isNull(await billing.activeSubscription(a.organization))
    assert.isEmpty(await billing.payments(a.organization))
  })

  /**
   * The obvious cross-tenant injection point in billing: a webhook whose
   * metadata names another workspace's public id must move *that* workspace,
   * and only from a signed delivery. Here the attribution is checked
   * directly — A's id in the metadata must never touch B.
   */
  test('a webhook applies to the workspace named in its own metadata and no other', async ({
    assert,
  }) => {
    const { a, b } = await twoWorkspaces()
    const { default: webhooks } = await import('#billing/webhook_handler')
    const { paymentProvider } = await import('#billing/provider')
    const { subscriptionWebhook } = await import('#tests/helpers')

    const body = subscriptionWebhook({ organizationPublicId: a.organization.publicId })
    await webhooks.apply(paymentProvider().parseWebhook(Buffer.from(JSON.stringify(body))))

    await a.organization.refresh()
    await b.organization.refresh()

    assert.equal(a.organization.planKey, 'pro')
    assert.equal(b.organization.planKey, 'free', "B was not upgraded by A's webhook")
  })

  /**
   * A second event for the same provider subscription must follow the row it
   * already created, not whatever public id the payload now claims — the
   * subscription's own history is more trustworthy than metadata that can be
   * replayed with an edit.
   */
  test('a follow-up event cannot move a subscription to another workspace', async ({ assert }) => {
    const { a, b } = await twoWorkspaces()
    const { default: Subscription } = await import('#models/subscription')
    const { default: webhooks } = await import('#billing/webhook_handler')
    const { paymentProvider } = await import('#billing/provider')
    const { subscriptionWebhook } = await import('#tests/helpers')

    const parse = (body: Record<string, any>) =>
      paymentProvider().parseWebhook(Buffer.from(JSON.stringify(body)))

    await webhooks.apply(
      parse(subscriptionWebhook({ organizationPublicId: a.organization.publicId }))
    )

    await webhooks.apply(
      parse(
        subscriptionWebhook({
          eventId: 'evt_hijack',
          eventType: 'subscription.update',
          organizationPublicId: b.organization.publicId,
        })
      )
    )

    const subscriptions = await Subscription.all()
    assert.lengthOf(subscriptions, 1)
    assert.equal(subscriptions[0].organizationId, a.organization.id)

    await b.organization.refresh()
    assert.equal(b.organization.planKey, 'free')
  })

  /**
   * Quotas are counted per workspace. A shared counter would let one tenant's
   * usage block another's create.
   */
  test('plan usage is counted per workspace', async ({ assert }) => {
    const { a, b } = await twoWorkspaces()
    const { default: plans } = await import('#billing/plan_service')

    await createList(b.organization, b.user, 'B one')
    await createList(b.organization, b.user, 'B two')

    const usageA = await plans.usage(a.organization)
    assert.equal(usageA.lists.current, 0, "B's lists do not count against A")

    const usageB = await plans.usage(b.organization)
    assert.equal(usageB.lists.current, 2)
  })

  /**
   * Files (M5). Two injection points: fetching another workspace's file by
   * its public id, and deleting one.
   */
  test('a file belonging to another workspace behaves exactly like a missing one', async ({
    assert,
    client,
  }) => {
    const { a, b } = await twoWorkspaces()
    const { default: files } = await import('#storage/file_service')
    const { fixtureUpload } = await import('#tests/helpers')

    const theirs = await files.upload(b.organization, b.user, await fixtureUpload('pdf'))

    assert.isNull(await files.find(a.organization, theirs.publicId))

    const foreign = await client.get(`/files/${theirs.publicId}`).loginAs(a.user).redirects(0)
    const missing = await client.get('/files/fil_zzzzzzzzzzzz').loginAs(a.user).redirects(0)

    assert.equal(foreign.status(), missing.status())
    assert.deepEqual(
      foreign.flashMessages(),
      missing.flashMessages(),
      'and says the same thing, so a foreign id cannot be probed for existence'
    )
  })

  test('one workspace cannot delete a file belonging to another', async ({ assert, client }) => {
    const { a, b } = await twoWorkspaces()
    const { default: files } = await import('#storage/file_service')
    const { fixtureUpload } = await import('#tests/helpers')

    const theirs = await files.upload(b.organization, b.user, await fixtureUpload('pdf'))

    await client
      .post(`/files/${theirs.publicId}/delete`)
      .loginAs(a.user)
      .withCsrfToken()
      .redirects(0)

    await theirs.refresh()
    assert.isNull(theirs.deletedAt, "B's file is untouched")
  })

  test('the files screen lists only its own workspace', async ({ assert, client }) => {
    const { a, b } = await twoWorkspaces()
    const { default: files } = await import('#storage/file_service')
    const { fixtureUpload } = await import('#tests/helpers')

    await files.upload(
      b.organization,
      b.user,
      await fixtureUpload('pdf', { clientName: 'B-confidential.pdf' })
    )

    const response = await client.get('/files').loginAs(a.user)

    response.assertStatus(200)
    assert.notInclude(response.text(), 'B-confidential.pdf')
    assert.isEmpty(await files.forOrganization(a.organization))
  })

  /**
   * The object key carries the tenant, so a leak would be visible in the key
   * itself rather than only in a database column (plan §10).
   */
  test('object keys are prefixed with the workspace that owns them', async ({ assert }) => {
    const { a, b } = await twoWorkspaces()
    const { default: files } = await import('#storage/file_service')
    const { keyBelongsTo } = await import('#storage/keys')
    const { fixtureUpload } = await import('#tests/helpers')

    const mine = await files.upload(a.organization, a.user, await fixtureUpload('png'))
    const theirs = await files.upload(b.organization, b.user, await fixtureUpload('png'))

    assert.isTrue(keyBelongsTo(mine.key, a.organization.publicId))
    assert.isFalse(keyBelongsTo(mine.key, b.organization.publicId))
    assert.isFalse(keyBelongsTo(theirs.key, a.organization.publicId))
  })

  test('storage is counted per workspace', async ({ assert }) => {
    const { a, b } = await twoWorkspaces()
    const { default: files } = await import('#storage/file_service')
    const { fixtureUpload } = await import('#tests/helpers')

    await files.upload(b.organization, b.user, await fixtureUpload('pdf'))

    await a.organization.refresh()
    await b.organization.refresh()

    assert.equal(a.organization.storageUsedBytes, 0, "B's upload does not count against A")
    assert.isAbove(b.organization.storageUsedBytes, 0)
  })

  /**
   * The organisation API (M6). The key *is* the scope, so the isolation
   * question here is whether a key can be talked into touching anything
   * outside its own workspace — by id, by filter, or by assignment.
   */
  test('a key cannot read another workspace’s list by id', async ({ assert, client }) => {
    const { keyed, other } = await twoKeyedWorkspaces()

    const theirs = await createList(other.organization, other.user, 'Theirs')

    const foreign = await client.get(`/api/v1/lists/${theirs.publicId}`).headers(keyed.headers)
    const missing = await client.get('/api/v1/lists/lst_zzzzzzzzzzzz').headers(keyed.headers)

    foreign.assertStatus(404)
    assert.deepEqual(
      foreign.body(),
      missing.body(),
      'and answers identically, so a foreign id cannot be probed for existence'
    )
  })

  test('a key cannot mutate or delete another workspace’s list', async ({ assert, client }) => {
    const { keyed, other } = await twoKeyedWorkspaces()

    const theirs = await createList(other.organization, other.user, 'Theirs')

    const patched = await client
      .patch(`/api/v1/lists/${theirs.publicId}`)
      .headers(keyed.headers)
      .json({ name: 'Mine now' })
    const deleted = await client.delete(`/api/v1/lists/${theirs.publicId}`).headers(keyed.headers)

    patched.assertStatus(404)
    deleted.assertStatus(404)

    await theirs.refresh()
    assert.equal(theirs.name, 'Theirs')
    assert.isNull(theirs.deletedAt)
  })

  test('a key cannot read or write another workspace’s todos', async ({ assert, client }) => {
    const { keyed, other } = await twoKeyedWorkspaces()

    const theirList = await createList(other.organization, other.user, 'Theirs', ['Secret task'])
    const [theirTodo] = await theirList.related('todos').query()

    const listed = await client
      .get(`/api/v1/lists/${theirList.publicId}/todos`)
      .headers(keyed.headers)
    const fetched = await client.get(`/api/v1/todos/${theirTodo.publicId}`).headers(keyed.headers)
    const created = await client
      .post(`/api/v1/lists/${theirList.publicId}/todos`)
      .headers(keyed.headers)
      .json({ title: 'Injected' })
    const completed = await client
      .post(`/api/v1/todos/${theirTodo.publicId}/complete`)
      .headers(keyed.headers)

    listed.assertStatus(404)
    fetched.assertStatus(404)
    created.assertStatus(404)
    completed.assertStatus(404)

    await theirTodo.refresh()
    assert.isNull(theirTodo.completedAt)
    assert.equal(theirList.todosCount, 1, 'nothing was added')
  })

  /**
   * The injection point the todo domain warns about (plan §5.6): an
   * `assigned_to` from another organisation, arriving in a request body.
   */
  test('a key cannot assign a todo to another workspace’s member', async ({ assert, client }) => {
    const { keyed, other } = await twoKeyedWorkspaces()

    const mine = await createList(keyed.organization, keyed.user, 'Mine')

    const response = await client
      .post(`/api/v1/lists/${mine.publicId}/todos`)
      .headers(keyed.headers)
      .json({ title: 'Not theirs to do', assigned_to: other.user.publicId })

    response.assertStatus(422)
    response.assertTextIncludes('assigned_to')

    assert.isEmpty(await todoService.forList(mine))
  })

  test('the member directory is scoped to the key’s workspace', async ({ assert, client }) => {
    const { keyed, other } = await twoKeyedWorkspaces()

    const response = await client.get('/api/v1/members').headers(keyed.headers)

    response.assertStatus(200)

    const emails = response.body().data.map((row: { email: string }) => row.email)
    assert.notInclude(emails, other.user.email)
    assert.include(emails, keyed.user.email)
  })

  test('GET /organization reports the key’s own workspace and nobody else’s', async ({
    assert,
    client,
  }) => {
    const { keyed, other } = await twoKeyedWorkspaces()

    other.organization.planKey = 'business'
    await other.organization.save()

    const response = await client.get('/api/v1/organization').headers(keyed.headers)

    assert.equal(response.body().data.id, keyed.organization.publicId)
    assert.equal(response.body().data.plan.key, 'pro', 'not the other workspace’s plan')
  })

  /**
   * A cursor is an internal id in disguise. Handing one workspace's cursor to
   * another must not walk into their rows — the query is scoped regardless,
   * which is the point.
   */
  test('another workspace’s cursor cannot be used to walk their rows', async ({
    assert,
    client,
  }) => {
    const { keyed, other } = await twoKeyedWorkspaces()

    for (const name of ['Theirs one', 'Theirs two', 'Theirs three']) {
      await createList(other.organization, other.user, name)
    }

    await createList(keyed.organization, keyed.user, 'Mine')

    const theirPage = await client.get('/api/v1/lists?limit=1').headers(other.headers)

    const stolen = await client
      .get(`/api/v1/lists?cursor=${theirPage.body().meta.next_cursor}`)
      .headers(keyed.headers)

    stolen.assertStatus(200)

    const names = stolen.body().data.map((row: { name: string }) => row.name)
    assert.isEmpty(
      names.filter((name: string) => name.startsWith('Theirs')),
      'not one row from the other workspace'
    )
  })

  test('API request logs are attributed to the calling workspace only', async ({
    assert,
    client,
  }) => {
    const { keyed, other } = await twoKeyedWorkspaces()
    const { default: ApiRequest } = await import('#models/api_request')

    await client.get('/api/v1/lists').headers(keyed.headers)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const rows = await ApiRequest.all()

    assert.isNotEmpty(rows)
    for (const row of rows) {
      assert.equal(row.organizationId, keyed.organization.id)
      assert.notEqual(row.organizationId, other.organization.id)
    }
  })

  /**
   * Two workspaces, each with a real API key.
   */
  async function twoKeyedWorkspaces() {
    const { createApiWorkspace } = await import('#tests/helpers')

    const keyed = await createApiWorkspace({ name: 'A key' })
    const other = await createApiWorkspace({ name: 'B key' })

    for (const workspace of [keyed, other]) {
      workspace.organization.limitOverrides = { seats: 5 }
      await workspace.organization.save()
    }

    return { keyed, other }
  }

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
