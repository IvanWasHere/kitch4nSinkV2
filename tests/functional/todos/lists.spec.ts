import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import Todo from '#models/todo'
import TodoList from '#models/todo_list'
import lists, { ListError } from '#todos/list_service'
import { addMember, createList, createWorkspace } from '#tests/helpers'

test.group('Lists', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('any member can create a list', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client
      .post('/lists')
      .loginAs(member)
      .form({ name: 'Launch checklist', color: 'green' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const list = await TodoList.findByOrFail('name', 'Launch checklist')
    assert.equal(list.organizationId, organization.id)
    assert.equal(list.createdByUserId, member.id)
    assert.equal(list.color, 'green')
    assert.equal(list.todosCount, 0)
    assert.match(list.publicId, /^lst_/)
  })

  /**
   * Lists belong to the organisation, not their author (D8) — every member
   * sees every list, and `createdBy` is provenance for the UI only.
   */
  test('every member sees every list, whoever made it', async ({ client }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')
    await createList(organization, user, 'Made by the owner')
    await createList(organization, member, 'Made by the member')

    const response = await client.get('/lists').loginAs(member)

    response.assertTextIncludes('Made by the owner')
    response.assertTextIncludes('Made by the member')
  })

  test('refuses a duplicate name in the same workspace', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    await createList(organization, user, 'Launch checklist')

    await assert.rejects(
      () => lists.create(organization, user, { name: 'Launch checklist' }),
      ListError
    )
  })

  /**
   * A plain unique index would have made a deleted list's name unusable
   * forever, which is why the rule lives in the transaction instead.
   */
  test('a deleted list frees its name', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const first = await createList(organization, user, 'Launch checklist')

    await lists.delete(first)

    const second = await lists.create(organization, user, { name: 'Launch checklist' })
    assert.notEqual(second.id, first.id)
  })

  test('two workspaces can use the same list name', async ({ assert }) => {
    const a = await createWorkspace({ email: 'a@example.com' })
    const b = await createWorkspace({ email: 'b@example.com' })

    await createList(a.organization, a.user, 'Launch checklist')
    const other = await lists.create(b.organization, b.user, { name: 'Launch checklist' })

    assert.equal(other.organizationId, b.organization.id)
  })

  test('a member can archive and unarchive', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')
    const list = await createList(organization, user)

    await client
      .post(`/lists/${list.publicId}/archive`)
      .loginAs(member)
      .withCsrfToken()
      .redirects(0)

    await list.refresh()
    assert.isTrue(list.isArchived)

    await client
      .post(`/lists/${list.publicId}/archive`)
      .loginAs(member)
      .withCsrfToken()
      .redirects(0)

    await list.refresh()
    assert.isFalse(list.isArchived)
  })

  test('archived lists are hidden until asked for', async ({ client }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Put away')
    await lists.archive(list)

    const hidden = await client.get('/lists').loginAs(user)
    hidden.assertTextIncludes('No lists yet')

    const shown = await client.get('/lists?archived=1').loginAs(user)
    shown.assertTextIncludes('Put away')
  })

  /**
   * Deleting cascades to every todo inside, so it is owner-only (plan §6) and
   * archiving is the member-safe equivalent.
   */
  test('a member cannot delete a list', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')
    const list = await createList(organization, user)

    await client.post(`/lists/${list.publicId}/delete`).loginAs(member).withCsrfToken().redirects(0)

    await list.refresh()
    assert.isFalse(list.isDeleted)
  })

  test('the owner can delete, and its todos go with it', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Launch', ['One', 'Two'])

    await client.post(`/lists/${list.publicId}/delete`).loginAs(user).withCsrfToken().redirects(0)

    await list.refresh()
    assert.isTrue(list.isDeleted)

    const remaining = await Todo.query().where('todo_list_id', list.id).whereNull('deleted_at')
    assert.lengthOf(remaining, 0)

    /**
     * Soft, not erased (D9) — a lapsed card or a mis-click must never destroy
     * a customer's work.
     */
    const all = await Todo.query().where('todo_list_id', list.id)
    assert.lengthOf(all, 2)
  })

  test('renaming keeps the list and its todos', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Old name', ['One'])

    await client
      .post(`/lists/${list.publicId}`)
      .loginAs(user)
      .form({ name: 'New name' })
      .withCsrfToken()
      .redirects(0)

    await list.refresh()
    assert.equal(list.name, 'New name')
    assert.equal(list.todosCount, 1)
  })

  test('lists are ordered sparsely as they are created', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const first = await createList(organization, user, 'One')
    const second = await createList(organization, user, 'Two')

    assert.equal(first.position, 100)
    assert.equal(second.position, 200)
  })
})
