import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import Todo from '#models/todo'
import todos, { TodoError } from '#todos/todo_service'
import { addMember, createList, createWorkspace } from '#tests/helpers'

test.group('Todos', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('any member can add a todo', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')
    const list = await createList(organization, user)

    await client
      .post(`/lists/${list.publicId}/todos`)
      .loginAs(member)
      .form({ title: 'Book the venue', priority: 'high' })
      .withCsrfToken()
      .redirects(0)

    const todo = await Todo.findByOrFail('title', 'Book the venue')
    assert.equal(todo.organizationId, organization.id)
    assert.equal(todo.todoListId, list.id)
    assert.equal(todo.createdByUserId, member.id)
    assert.equal(todo.priority, 'high')
    assert.match(todo.publicId, /^tdo_/)
  })

  /**
   * The counter is denormalised because the per-list cap is checked on every
   * create (plan §5.5), and it is only ever moved inside the same transaction
   * as the insert or delete it accounts for.
   */
  test('the list counter tracks creates and deletes', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Counting', ['One', 'Two', 'Three'])

    assert.equal(list.todosCount, 3)

    const todo = await Todo.findByOrFail('title', 'Two')
    await todos.delete(todo)

    await list.refresh()
    assert.equal(list.todosCount, 2, 'a soft-deleted todo does not count')
  })

  /**
   * A fully ticked-off list is still full: the way out is to delete or move
   * them, and the UI has to say so because it otherwise reads as a bug.
   */
  test('completed todos still count', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Counting', ['One', 'Two'])

    for (const todo of await todos.forList(list)) {
      await todos.complete(todo, user)
    }

    await list.refresh()
    assert.equal(list.todosCount, 2)
  })

  test('completing records who and when, and un-ticking clears both', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Launch', ['One'])
    const todo = await Todo.findByOrFail('title', 'One')

    await client.post(`/todos/${todo.publicId}/complete`).loginAs(user).withCsrfToken().redirects(0)

    await todo.refresh()
    assert.isTrue(todo.isComplete)
    assert.equal(todo.completedByUserId, user.id)

    await client.post(`/todos/${todo.publicId}/complete`).loginAs(user).withCsrfToken().redirects(0)

    await todo.refresh()
    assert.isFalse(todo.isComplete)
    assert.isNull(todo.completedByUserId, 'no stale "completed by" left behind')

    void list
  })

  test('a todo can be assigned to a colleague', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')
    const list = await createList(organization, user)

    await client
      .post(`/lists/${list.publicId}/todos`)
      .loginAs(user)
      .form({ title: 'Book the venue', assignedTo: member.publicId })
      .withCsrfToken()
      .redirects(0)

    const todo = await Todo.findByOrFail('title', 'Book the venue')
    assert.equal(todo.assignedToUserId, member.id)
  })

  /**
   * The obvious cross-tenant injection point: `assigned_to` arrives in a
   * request body (plan §5.6).
   */
  test('refuses an assignee from another workspace', async ({ assert }) => {
    const { user, organization } = await createWorkspace({ email: 'a@example.com' })
    const other = await createWorkspace({ email: 'b@example.com' })
    const list = await createList(organization, user)

    await assert.rejects(
      () =>
        todos.create(organization, list, user, {
          title: 'Sneaky',
          assignedToPublicId: other.user.publicId,
        }),
      TodoError
    )
  })

  test('refuses an assignee that does not exist', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user)

    await assert.rejects(
      () =>
        todos.create(organization, list, user, {
          title: 'Sneaky',
          assignedToPublicId: 'usr_zzzzzzzzzzzz',
        }),
      TodoError
    )
  })

  test('a member can delete a todo', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')
    const list = await createList(organization, user, 'Launch', ['One'])
    const todo = await Todo.findByOrFail('title', 'One')

    await client.post(`/todos/${todo.publicId}/delete`).loginAs(member).withCsrfToken().redirects(0)

    await todo.refresh()
    assert.isTrue(todo.isDeleted)

    await list.refresh()
    assert.equal(list.todosCount, 0)
  })

  test('todos are ordered sparsely and can be moved between two others', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Launch', ['One', 'Two', 'Three'])
    const ordered = await todos.forList(list)

    assert.deepEqual(
      ordered.map((todo) => todo.position),
      [100, 200, 300]
    )

    await todos.move(ordered[2], ordered[0].publicId, ordered[1].publicId)

    const reordered = await todos.forList(list)
    assert.deepEqual(
      reordered.map((todo) => todo.title),
      ['One', 'Three', 'Two']
    )
  })

  test('due dates land at the end of the day in the workspace timezone', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    organization.timezone = 'Pacific/Auckland'
    await organization.save()

    const list = await createList(organization, user)

    await client
      .post(`/lists/${list.publicId}/todos`)
      .loginAs(user)
      .form({ title: 'Due today', dueAt: '2027-03-01' })
      .withCsrfToken()
      .redirects(0)

    const todo = await Todo.findByOrFail('title', 'Due today')
    const local = todo.dueAt!.setZone('Pacific/Auckland')

    assert.equal(local.toFormat('yyyy-LL-dd'), '2027-03-01')
    assert.equal(local.hour, 23, 'end of that day where the workspace is, not midnight UTC')
  })

  test('overdue means past due and not done', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user)

    const overdue = await todos.create(organization, list, user, {
      title: 'Late',
      dueAt: DateTime.utc().minus({ days: 1 }),
      assignedToPublicId: user.publicId,
    })
    await todos.create(organization, list, user, {
      title: 'Later',
      dueAt: DateTime.utc().plus({ days: 1 }),
      assignedToPublicId: user.publicId,
    })

    const chased = await todos.overdueFor(user)
    assert.deepEqual(
      chased.map((todo) => todo.title),
      ['Late']
    )

    await todos.complete(overdue, user)
    assert.lengthOf(await todos.overdueFor(user), 0, 'finishing it late is still finishing it')
  })

  test('cannot add to an archived list', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user)

    const { default: lists } = await import('#todos/list_service')
    await lists.archive(list)

    await client
      .post(`/lists/${list.publicId}/todos`)
      .loginAs(user)
      .form({ title: 'Should not appear' })
      .withCsrfToken()
      .redirects(0)

    assert.isNull(await Todo.findBy('title', 'Should not appear'))
  })
})
