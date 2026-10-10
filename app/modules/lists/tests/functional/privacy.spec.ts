import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

import type User from '#models/user'
import Todo from '#modules/lists/models/todo'
import TodoList from '#modules/lists/models/todo_list'
import { listsPrivacyContributor } from '#modules/lists/privacy'
import { addMember, createList, createWorkspace } from '#tests/helpers'

/**
 * The demo domain's share of a privacy export and deletion (plan §22.8,
 * D14). Tested here, against the contributor, because what happens to lists
 * and todos is this module's decision; the privacy module only asks.
 */
function erase(user: User, lastMember: boolean) {
  return db.transaction((trx) =>
    listsPrivacyContributor.erase!(user, {
      trx,
      lastMember,
      originalEmail: user.email,
      afterCommit: () => {},
    })
  )
}

test.group('Lists — privacy', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('the export holds what the person did, not the whole workspace', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const colleague = await addMember(organization, user, 'sam@example.com')
    await createList(organization, user, 'Mine', ['Mine to do'])
    await createList(organization, colleague, 'Theirs', ['Theirs to do'])

    const exported = (await listsPrivacyContributor.export(user)) as {
      listsCreated: { name: string }[]
      todos: { title: string; youCreatedIt: boolean }[]
    }

    assert.deepEqual(
      exported.listsCreated.map((list) => list.name),
      ['Mine']
    )
    assert.deepEqual(
      exported.todos.map((todo) => todo.title),
      ['Mine to do']
    )
    assert.isTrue(exported.todos[0].youCreatedIt)
  })

  test('while others remain, nothing is touched — not even an assignment', async ({ assert }) => {
    const { user: owner, organization } = await createWorkspace()
    const member = await addMember(organization, owner, 'sam@example.com')
    const list = await createList(organization, member, 'Shared', ['Ship it'])
    const todo = await Todo.findByOrFail('todo_list_id', list.id)
    todo.assignedToUserId = member.id
    await todo.save()

    await erase(member, false)

    assert.exists(await TodoList.find(list.id))
    await todo.refresh()
    assert.equal(todo.assignedToUserId, member.id)
  })

  test('as the last member, every list and todo in the workspace goes', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'Mine', ['One', 'Two'])
    await list.softDelete()

    await erase(user, true)

    assert.lengthOf(await TodoList.query().where('organization_id', organization.id), 0)
    assert.lengthOf(
      await Todo.query().where('organization_id', organization.id),
      0,
      'hard-deleted, soft-deleted rows included'
    )
  })

  test('erasing twice is harmless', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    await createList(organization, user, 'Mine', ['One'])

    await erase(user, true)
    await erase(user, true)

    assert.lengthOf(await TodoList.query().where('organization_id', organization.id), 0)
  })
})
