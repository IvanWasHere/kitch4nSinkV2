import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import Todo from '#models/todo'
import User from '#models/user'
import TodoList from '#models/todo_list'
import type Organization from '#models/organization'
import plans from '#billing/plan_service'
import { nextPosition, positionBetween } from '#todos/position'

export type Priority = 'low' | 'normal' | 'high'

export interface CreateTodoData {
  title: string
  notes?: string | null
  priority?: Priority
  dueAt?: DateTime | null
  assignedToPublicId?: string | null
}

export class TodoError extends Error {
  constructor(
    message: string,
    readonly reason: 'assignee_not_in_organization' | 'needs_renumbering'
  ) {
    super(message)
  }
}

export class TodoService {
  async find(organization: Organization, publicId: string): Promise<Todo | null> {
    return Todo.query()
      .where('public_id', publicId)
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .first()
  }

  async forList(list: TodoList, filter: 'all' | 'open' | 'done' = 'all'): Promise<Todo[]> {
    const query = Todo.query()
      .where('todo_list_id', list.id)
      .whereNull('deleted_at')
      .preload('assignedTo')
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')

    if (filter === 'open') {
      query.whereNull('completed_at')
    }

    if (filter === 'done') {
      query.whereNotNull('completed_at')
    }

    return query
  }

  /**
   * Create a todo, if the list has room, and keep its counter honest in the
   * same breath.
   *
   * `todos_count` is denormalised because the per-list cap is checked on
   * every create (plan §5.5), and it is only ever mutated inside the same
   * transaction as the insert — never as a follow-up write that a crash could
   * skip.
   *
   * The `todosPerList` guard reads that counter under the list's own row lock
   * and re-checks before inserting (plan §7.4). **Completed todos still
   * count**: a fully ticked-off list at its cap is still full, and the way out
   * is to delete or move them. The UI has to say so, because it otherwise
   * reads as a bug.
   */
  async create(
    organization: Organization,
    list: TodoList,
    actor: User,
    data: CreateTodoData
  ): Promise<Todo> {
    return db.transaction(async (trx) => {
      /**
       * Locked so two simultaneous creates cannot read the same count — both
       * the cap below and the counter increment are read-modify-writes over
       * this row.
       */
      const locked = await TodoList.query({ client: trx })
        .forUpdate()
        .where('id', list.id)
        .where('organization_id', organization.id)
        .firstOrFail()

      plans.assertWithinLimit(organization, 'todosPerList', locked.todosCount + 1)

      const assignedToUserId = await this.resolveAssignee(
        organization,
        data.assignedToPublicId,
        trx
      )

      const positions = await this.currentPositions(locked, trx)

      const todo = await Todo.create(
        {
          organizationId: organization.id,
          todoListId: locked.id,
          createdByUserId: actor.id,
          assignedToUserId,
          title: data.title.trim(),
          notes: data.notes?.trim() || null,
          priority: data.priority ?? 'normal',
          dueAt: data.dueAt ?? null,
          position: nextPosition(positions),
        },
        { client: trx }
      )

      locked.useTransaction(trx)
      locked.todosCount = locked.todosCount + 1
      await locked.save()

      return todo
    })
  }

  async update(
    organization: Organization,
    todo: Todo,
    data: Partial<CreateTodoData>
  ): Promise<Todo> {
    return db.transaction(async (trx) => {
      if (data.assignedToPublicId !== undefined) {
        todo.assignedToUserId = await this.resolveAssignee(
          organization,
          data.assignedToPublicId,
          trx
        )
      }

      if (data.title !== undefined) todo.title = data.title.trim()
      if (data.notes !== undefined) todo.notes = data.notes?.trim() || null
      if (data.priority !== undefined) todo.priority = data.priority
      if (data.dueAt !== undefined) todo.dueAt = data.dueAt ?? null

      todo.useTransaction(trx)
      await todo.save()

      return todo
    })
  }

  /**
   * Tick and un-tick. Completion is a timestamp plus who did it; un-ticking
   * nulls both together so a stale "completed by" can never linger.
   */
  async complete(todo: Todo, actor: User): Promise<void> {
    todo.completedAt = DateTime.utc()
    todo.completedByUserId = actor.id
    await todo.save()
  }

  async uncomplete(todo: Todo): Promise<void> {
    todo.completedAt = null
    todo.completedByUserId = null
    await todo.save()
  }

  /**
   * Soft-delete, decrementing the list counter in the same transaction.
   *
   * Soft-deleted todos do not count, so the counter goes down — unlike
   * completed ones, which still do (plan §5.5).
   */
  async delete(todo: Todo): Promise<void> {
    await db.transaction(async (trx) => {
      const locked = await TodoList.query({ client: trx })
        .forUpdate()
        .where('id', todo.todoListId)
        .firstOrFail()

      todo.useTransaction(trx)
      todo.deletedAt = DateTime.utc()
      await todo.save()

      locked.useTransaction(trx)
      locked.todosCount = Math.max(locked.todosCount - 1, 0)
      await locked.save()
    })
  }

  /**
   * Drop a todo between two others.
   *
   * Sparse positions mean this is one write. When the neighbours are adjacent
   * integers there is no room left, and the caller is told to renumber rather
   * than the whole list being rewritten inside a drag handler.
   */
  async move(todo: Todo, beforeId: string | null, afterId: string | null): Promise<void> {
    const siblings = await Todo.query()
      .where('todo_list_id', todo.todoListId)
      .whereNull('deleted_at')
      .orderBy('position', 'asc')

    const before = beforeId ? siblings.find((sibling) => sibling.publicId === beforeId) : null
    const after = afterId ? siblings.find((sibling) => sibling.publicId === afterId) : null

    const position = positionBetween(before?.position ?? null, after?.position ?? null)

    if (position === null) {
      throw new TodoError(
        'This list needs renumbering before anything else can be moved there.',
        'needs_renumbering'
      )
    }

    todo.position = position
    await todo.save()
  }

  /**
   * Todos assigned to someone and past due — what the daily digest reports.
   */
  async overdueFor(user: User): Promise<Todo[]> {
    const todos = await Todo.query()
      .where('assigned_to_user_id', user.id)
      .whereNull('deleted_at')
      .whereNull('completed_at')
      .whereNotNull('due_at')
      .preload('todoList')

    /**
     * Overdue is decided from the model rather than in SQL: comparing a
     * timestamp column against a bound value means different things on SQLite
     * and Postgres (see CONTRIBUTING).
     */
    return todos.filter((todo) => todo.isOverdue && !todo.todoList.isDeleted)
  }

  /**
   * Turn an assignee's public id into a user id, refusing anyone outside the
   * organisation.
   *
   * This is the obvious cross-tenant injection point — `assigned_to` arrives
   * in a request body — so it is validated against the caller's organisation
   * rather than trusted (plan §5.6).
   */
  private async resolveAssignee(
    organization: Organization,
    assignedToPublicId: string | null | undefined,
    trx: TransactionClientContract
  ): Promise<number | null> {
    if (!assignedToPublicId) {
      return null
    }

    const assignee = await User.query({ client: trx })
      .where('public_id', assignedToPublicId)
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .first()

    if (!assignee) {
      throw new TodoError(
        'You can only assign a todo to someone in this workspace.',
        'assignee_not_in_organization'
      )
    }

    return assignee.id
  }

  private async currentPositions(
    list: TodoList,
    trx: TransactionClientContract
  ): Promise<number[]> {
    const todos = await Todo.query({ client: trx })
      .where('todo_list_id', list.id)
      .whereNull('deleted_at')
      .select('position')

    return todos.map((todo) => todo.position)
  }
}

export default new TodoService()
