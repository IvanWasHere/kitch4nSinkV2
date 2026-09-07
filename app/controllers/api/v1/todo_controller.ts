import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

import Todo from '#models/todo'
import User from '#models/user'
import type TodoList from '#models/todo_list'
import lists from '#todos/list_service'
import todos, { TodoError } from '#todos/todo_service'
import { requireScope } from '#middleware/api_key_auth'
import { ApiNotFoundException, ApiValidationException } from '#api/errors'
import { decodeCursor, pageSize, toCursorPage } from '#api/cursor'
import { sendItem, sendPage } from '#api/responses'
import TodoTransformer from '#transformers/todo_transformer'
import { apiCreateTodoValidator, apiUpdateTodoValidator } from '#validators/api'

/**
 * `/api/v1/…/todos` (plan §11).
 *
 * The resource an integration actually syncs, so this is where the API's
 * awkward edges live: a due date that has to survive a round trip, an
 * assignee that must be validated against the calling organisation, and a
 * `402` mid-import when a list fills up.
 */
export default class ApiTodoController {
  async index(ctx: HttpContext) {
    requireScope(ctx, 'todos:read')

    const list = await this.findListOrFail(ctx)
    const limit = pageSize(ctx.request.input('limit'))
    const after = decodeCursor(ctx.request.input('cursor'))

    const query = Todo.query()
      .where('todo_list_id', list.id)
      /**
       * Filtered on the todo's own `organization_id` as well as its list's.
       * The column is denormalised precisely so a tenant filter never depends
       * on a join being remembered (plan §5.2).
       */
      .where('organization_id', ctx.organization.id)
      .whereNull('deleted_at')
      .preload('assignedTo')
      .preload('todoList')
      .orderBy('id', 'asc')
      .limit(limit + 1)

    if (after) {
      query.where('id', '>', after)
    }

    const completed = String(ctx.request.input('completed', '')).toLowerCase()

    if (completed === 'true' || completed === '1') {
      query.whereNotNull('completed_at')
    } else if (completed === 'false' || completed === '0') {
      query.whereNull('completed_at')
    }

    /**
     * `assigned_to` filters by a member's public id. An id from another
     * organisation matches nothing rather than erroring — a filter is not a
     * write, so there is nothing to refuse, and 422 here would break a
     * client whose cached member list is stale.
     */
    const assignedTo = ctx.request.input('assigned_to')

    if (assignedTo) {
      const member = await User.query()
        .where('public_id', String(assignedTo))
        .where('organization_id', ctx.organization.id)
        .first()

      query.where('assigned_to_user_id', member?.id ?? -1)
    }

    const page = toCursorPage(await query, limit)

    return sendPage(ctx, TodoTransformer.transform(page.rows), {
      nextCursor: page.nextCursor,
      limit,
    })
  }

  async show(ctx: HttpContext) {
    requireScope(ctx, 'todos:read')

    const todo = await this.findTodoOrFail(ctx)
    await todo.load('assignedTo')
    await todo.load('todoList')

    return sendItem(ctx, TodoTransformer.transform(todo))
  }

  /**
   * `402 plan_limit_exceeded` when the list is at its `todosPerList` cap.
   * Completed todos still count, which is why `GET /organization` and the
   * list's own `todos_count` are both on the wire (plan §5.5).
   */
  async store(ctx: HttpContext) {
    requireScope(ctx, 'todos:write')

    const list = await this.findListOrFail(ctx)
    const payload = await ctx.request.validateUsing(apiCreateTodoValidator)

    try {
      const todo = await todos.create(ctx.organization, list, await this.actorFor(ctx), {
        title: payload.title,
        notes: payload.notes ?? null,
        priority: payload.priority,
        dueAt: this.parseDueAt(payload.due_at),
        assignedToPublicId: payload.assigned_to ?? null,
      })

      await todo.load('assignedTo')
      await todo.load('todoList')

      return sendItem(ctx, TodoTransformer.transform(todo), 201)
    } catch (error) {
      throw this.translate(error)
    }
  }

  async update(ctx: HttpContext) {
    requireScope(ctx, 'todos:write')

    const todo = await this.findTodoOrFail(ctx)
    const payload = await ctx.request.validateUsing(apiUpdateTodoValidator)

    try {
      await todos.update(ctx.organization, todo, {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
        ...(payload.due_at !== undefined ? { dueAt: this.parseDueAt(payload.due_at) } : {}),
        ...(payload.assigned_to !== undefined ? { assignedToPublicId: payload.assigned_to } : {}),
      })

      /**
       * `position` is set directly rather than through the drag-and-drop
       * `move()` helper: an API client knows the number it wants, and
       * expressing that as "between these two neighbours" would make a
       * simple reorder require two extra reads.
       */
      if (payload.position !== undefined) {
        todo.position = payload.position
        await todo.save()
      }
    } catch (error) {
      throw this.translate(error)
    }

    await todo.load('assignedTo')
    await todo.load('todoList')

    return sendItem(ctx, TodoTransformer.transform(todo))
  }

  /**
   * Completing is a POST to a sub-resource rather than `PATCH completed`,
   * because it is not a field assignment: it records *who* finished it and
   * when (plan §5.6). Idempotent — completing a done todo is a success.
   */
  async complete(ctx: HttpContext) {
    requireScope(ctx, 'todos:write')

    const todo = await this.findTodoOrFail(ctx)

    if (!todo.completedAt) {
      await todos.complete(todo, await this.actorFor(ctx))
    }

    await todo.load('assignedTo')
    await todo.load('todoList')

    return sendItem(ctx, TodoTransformer.transform(todo))
  }

  /**
   * Un-completing, for a client that ticked the wrong thing.
   */
  async uncomplete(ctx: HttpContext) {
    requireScope(ctx, 'todos:write')

    const todo = await this.findTodoOrFail(ctx)

    if (todo.completedAt) {
      await todos.uncomplete(todo)
    }

    await todo.load('assignedTo')
    await todo.load('todoList')

    return sendItem(ctx, TodoTransformer.transform(todo))
  }

  async destroy(ctx: HttpContext) {
    requireScope(ctx, 'todos:write')

    const todo = await this.findTodoOrFail(ctx)
    await todos.delete(todo)

    return ctx.response.noContent()
  }

  /**
   * An ISO 8601 instant, or null.
   *
   * Strict: a date guessed from an ambiguous string is a task that silently
   * becomes overdue in the wrong week, so anything unparseable is a 422 with
   * the field named rather than a null quietly written.
   */
  private parseDueAt(value: string | null | undefined): DateTime | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    const parsed = DateTime.fromISO(value, { zone: 'utc' })

    if (!parsed.isValid) {
      throw new ApiValidationException(
        { due_at: ['due_at must be an ISO 8601 timestamp'] },
        'due_at must be an ISO 8601 timestamp.'
      )
    }

    return parsed.toUTC()
  }

  /**
   * `assigned_to` from another organisation is a **422, never a silent null**
   * (plan §11) — it is the obvious cross-tenant injection point, and quietly
   * dropping it would leave a client believing an assignment happened.
   */
  private translate(error: unknown): unknown {
    if (error instanceof TodoError && error.reason === 'assignee_not_in_organization') {
      throw new ApiValidationException(
        { assigned_to: ['assigned_to must be a member of this organisation'] },
        error.message
      )
    }

    if (error instanceof TodoError) {
      throw new ApiValidationException({ base: [error.message] }, error.message)
    }

    return error
  }

  private async findListOrFail(ctx: HttpContext): Promise<TodoList> {
    const list = await lists.find(ctx.organization, ctx.params.listId ?? ctx.params.id)

    if (!list) {
      throw new ApiNotFoundException('That list does not exist.')
    }

    return list
  }

  private async findTodoOrFail(ctx: HttpContext): Promise<Todo> {
    const todo = await todos.find(ctx.organization, ctx.params.id)

    if (!todo) {
      throw new ApiNotFoundException('That todo does not exist.')
    }

    return todo
  }

  private async actorFor(ctx: HttpContext): Promise<User> {
    const creator = ctx.apiKey?.createdByUserId
      ? await User.query()
          .where('id', ctx.apiKey.createdByUserId)
          .where('organization_id', ctx.organization.id)
          .first()
      : null

    return (
      creator ??
      (await User.query()
        .where('organization_id', ctx.organization.id)
        .where('role', 'owner')
        .firstOrFail())
    )
  }
}
