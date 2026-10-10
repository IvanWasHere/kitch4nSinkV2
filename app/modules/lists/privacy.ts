import type { DateTime } from 'luxon'

import type User from '#models/user'
import Todo from '#modules/lists/models/todo'
import TodoList from '#modules/lists/models/todo_list'
import type { PrivacyContributor, PrivacyEraseContext } from '#privacy/registry'

const iso = (value: DateTime | null | undefined) => (value ? value.toISO() : null)

/**
 * The demo domain's share of a person's data (plan §22.8). Registered in
 * `start/privacy.ts`, so it leaves with the module.
 *
 * Lists and todos belong to the workspace (D8), so what is exported is what
 * this person *did*: the lists they made, and the todos they created, were
 * assigned or finished — not the whole workspace's work.
 */
export const listsPrivacyContributor: PrivacyContributor = {
  key: 'listsAndTodos',
  describes:
    'Lists you created, and every todo you created, were assigned or completed, with what your part in each was.',
  excludes: "Your colleagues' names on shared todos — they are theirs.",
  covers: [
    'todo_lists.created_by_user_id',
    'todos.created_by_user_id',
    'todos.assigned_to_user_id',
    'todos.completed_by_user_id',
  ],

  async export(user: User) {
    const lists = await TodoList.query()
      .where('created_by_user_id', user.id)
      .whereNull('deleted_at')
      .orderBy('id')

    const todos = await Todo.query()
      .whereNull('deleted_at')
      .where((query) =>
        query
          .where('created_by_user_id', user.id)
          .orWhere('assigned_to_user_id', user.id)
          .orWhere('completed_by_user_id', user.id)
      )
      .preload('todoList')
      .orderBy('id')

    return {
      listsCreated: lists.map((list) => ({
        name: list.name,
        description: list.description,
        createdAt: iso(list.createdAt),
        archivedAt: iso(list.archivedAt),
      })),
      todos: todos.map((todo) => ({
        title: todo.title,
        notes: todo.notes,
        list: todo.todoList?.name ?? null,
        priority: todo.priority,
        dueAt: iso(todo.dueAt),
        completedAt: iso(todo.completedAt),
        youCreatedIt: todo.createdByUserId === user.id,
        assignedToYou: todo.assignedToUserId === user.id,
        youCompletedIt: todo.completedByUserId === user.id,
      })),
    }
  },

  /**
   * Lists and todos are the workspace's, so they stay while anybody else is
   * in it — not even an assignment is touched (plan §22.8.4, D14). When the
   * person was its last member, the workspace's lists and todos go, deleted
   * outright: a soft-deleted row would still hold the data.
   */
  async erase(user: User, { trx, lastMember }: PrivacyEraseContext) {
    if (!lastMember) {
      return
    }

    await Todo.query({ client: trx }).where('organization_id', user.organizationId).delete()
    await TodoList.query({ client: trx }).where('organization_id', user.organizationId).delete()
  },
}
