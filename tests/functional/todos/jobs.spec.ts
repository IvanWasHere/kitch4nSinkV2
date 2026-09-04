import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import Todo from '#models/todo'
import queue from '#queue/queue_service'
import todos from '#todos/todo_service'
import overdueDigestJob from '#queue/jobs/overdue_digest_job'
import reconcileCountersJob from '#queue/jobs/reconcile_counters_job'
import normalizePositionsJob from '#queue/jobs/normalize_positions_job'
import { addMember, createList, createWorkspace, queuedMailsTo, runQueue } from '#tests/helpers'

test.group('Todo domain jobs', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  /**
   * The counter is only ever written inside the insert transaction, so drift
   * can only mean a bug. The job corrects the number so the product stays
   * usable, but the point of it is the alert (plan §5.5).
   */
  test('reconciling reports drift and repairs the number', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Counting', ['One', 'Two'])

    list.todosCount = 99
    await list.save()

    await queue.dispatch(reconcileCountersJob)
    await runQueue('default')

    await list.refresh()
    assert.equal(list.todosCount, 2)
  })

  test('reconciling an accurate counter changes nothing', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Counting', ['One'])
    const before = list.updatedAt?.toMillis()

    await queue.dispatch(reconcileCountersJob)
    await runQueue('default')

    await list.refresh()
    assert.equal(list.todosCount, 1)
    assert.equal(list.updatedAt?.toMillis(), before)
  })

  test('renumbering restores the gaps without changing the order', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Launch', ['One', 'Two', 'Three'])

    const crowded = await todos.forList(list)
    crowded[1].position = 101
    await crowded[1].save()
    crowded[2].position = 102
    await crowded[2].save()

    await queue.dispatch(normalizePositionsJob, { listId: list.id })
    await runQueue('default')

    const spaced = await todos.forList(list)
    assert.deepEqual(
      spaced.map((todo) => todo.position),
      [100, 200, 300]
    )
    assert.deepEqual(
      spaced.map((todo) => todo.title),
      ['One', 'Two', 'Three']
    )
  })

  test('a list that is already spaced is left alone', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Launch', ['One', 'Two'])
    const original = await todos.forList(list)
    const before = original.map((todo) => todo.updatedAt?.toMillis())

    await queue.dispatch(normalizePositionsJob, { listId: list.id })
    await runQueue('default')

    const refreshed = await todos.forList(list)
    const after = refreshed.map((todo) => todo.updatedAt?.toMillis())
    assert.deepEqual(after, before)
  })

  /**
   * Renumbering is what makes room again after enough drops in one slot.
   */
  test('renumbering makes a crowded slot movable again', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Launch', ['One', 'Two', 'Three'])

    const crowded = await todos.forList(list)
    crowded[1].position = 101
    await crowded[1].save()

    await assert.rejects(() => todos.move(crowded[2], crowded[0].publicId, crowded[1].publicId))

    await queue.dispatch(normalizePositionsJob, { listId: list.id })
    await runQueue('default')

    const spaced = await todos.forList(list)
    await todos.move(spaced[2], spaced[0].publicId, spaced[1].publicId)

    const reordered = await todos.forList(list)
    assert.deepEqual(
      reordered.map((todo) => todo.title),
      ['One', 'Three', 'Two']
    )
  })

  test('the digest emails only people with something overdue', async ({ assert }) => {
    const { user, organization } = await createWorkspace({ email: 'owner@example.com' })
    const member = await addMember(organization, user, 'sam@example.com')
    const list = await createList(organization, user)

    await todos.create(organization, list, user, {
      title: 'Late',
      dueAt: DateTime.utc().minus({ days: 2 }),
      assignedToPublicId: member.publicId,
    })
    await todos.create(organization, list, user, {
      title: 'Fine',
      dueAt: DateTime.utc().plus({ days: 2 }),
      assignedToPublicId: user.publicId,
    })

    await queue.dispatch(overdueDigestJob)
    await runQueue('default')

    const toMember = await queuedMailsTo(member.email)
    const toOwner = await queuedMailsTo(user.email)

    assert.lengthOf(toMember, 1)
    assert.include(toMember[0].subject, '1 overdue todo')
    assert.include(toMember[0].html, 'Late')
    assert.lengthOf(toOwner, 0, 'a daily "nothing is overdue" email teaches people to filter you')
  })

  test('the digest is one email however many todos are late', async ({ assert }) => {
    const { user, organization } = await createWorkspace({ email: 'owner@example.com' })
    const list = await createList(organization, user)

    for (const title of ['One', 'Two', 'Three']) {
      await todos.create(organization, list, user, {
        title,
        dueAt: DateTime.utc().minus({ days: 1 }),
        assignedToPublicId: user.publicId,
      })
    }

    await queue.dispatch(overdueDigestJob)
    await runQueue('default')

    const queued = await queuedMailsTo(user.email)
    assert.lengthOf(queued, 1)
    assert.include(queued[0].subject, '3 overdue todos')
  })

  test('a todo in a deleted list is not chased', async ({ assert }) => {
    const { user, organization } = await createWorkspace({ email: 'owner@example.com' })
    const list = await createList(organization, user)

    await todos.create(organization, list, user, {
      title: 'Late',
      dueAt: DateTime.utc().minus({ days: 1 }),
      assignedToPublicId: user.publicId,
    })

    const { default: lists } = await import('#todos/list_service')
    await lists.delete(list)

    await queue.dispatch(overdueDigestJob)
    await runQueue('default')

    assert.lengthOf(await queuedMailsTo(user.email), 0)
    void Todo
  })
})
