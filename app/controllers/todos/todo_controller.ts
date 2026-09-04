import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

import lists from '#todos/list_service'
import todos, { TodoError } from '#todos/todo_service'
import queue from '#queue/queue_service'
import normalizePositionsJob from '#queue/jobs/normalize_positions_job'
import { createTodoValidator, moveTodoValidator } from '#validators/todo'

export default class TodoController {
  async store({ params, request, response, session, auth, organization, bouncer }: HttpContext) {
    const list = await lists.find(organization, params.listId)

    if (!list) {
      session.flash('error', 'That list no longer exists.')
      return response.redirect().toRoute('lists.index')
    }

    await bouncer.with('TodoPolicy').authorize('create', list)

    const payload = await request.validateUsing(createTodoValidator)

    try {
      await todos.create(organization, list, auth.use('web').user!, {
        title: payload.title,
        notes: payload.notes ?? null,
        priority: payload.priority,
        dueAt: this.parseDueDate(payload.dueAt, organization.timezone),
        assignedToPublicId: payload.assignedTo ?? null,
      })
    } catch (error) {
      if (error instanceof TodoError) {
        session.flash('error', error.message)
      } else {
        throw error
      }
    }

    return response.redirect().toRoute('lists.show', { id: list.publicId })
  }

  async update({ params, request, response, session, organization, bouncer }: HttpContext) {
    const todo = await todos.find(organization, params.id)

    if (!todo) {
      session.flash('error', 'That todo no longer exists.')
      return response.redirect().toRoute('lists.index')
    }

    await bouncer.with('TodoPolicy').authorize('update', todo)

    const payload = await request.validateUsing(createTodoValidator)

    try {
      await todos.update(organization, todo, {
        title: payload.title,
        notes: payload.notes ?? null,
        priority: payload.priority,
        dueAt: this.parseDueDate(payload.dueAt, organization.timezone),
        assignedToPublicId: payload.assignedTo ?? null,
      })
      session.flash('success', 'Todo updated.')
    } catch (error) {
      if (error instanceof TodoError) {
        session.flash('error', error.message)
      } else {
        throw error
      }
    }

    await todo.load('todoList')
    return response.redirect().toRoute('lists.show', { id: todo.todoList.publicId })
  }

  /**
   * One route toggles: completing something already done un-does it, which is
   * what a checkbox means to the person clicking it.
   */
  async complete({ params, response, session, auth, organization, bouncer }: HttpContext) {
    const todo = await todos.find(organization, params.id)

    if (!todo) {
      session.flash('error', 'That todo no longer exists.')
      return response.redirect().toRoute('lists.index')
    }

    await bouncer.with('TodoPolicy').authorize('complete', todo)

    if (todo.isComplete) {
      await todos.uncomplete(todo)
    } else {
      await todos.complete(todo, auth.use('web').user!)
    }

    await todo.load('todoList')
    return response.redirect().toRoute('lists.show', { id: todo.todoList.publicId })
  }

  async destroy({ params, response, session, organization, bouncer }: HttpContext) {
    const todo = await todos.find(organization, params.id)

    if (!todo) {
      session.flash('error', 'That todo no longer exists.')
      return response.redirect().toRoute('lists.index')
    }

    await bouncer.with('TodoPolicy').authorize('delete', todo)
    await todo.load('todoList')
    const listPublicId = todo.todoList.publicId

    await todos.delete(todo)

    session.flash('success', 'Todo deleted.')
    return response.redirect().toRoute('lists.show', { id: listPublicId })
  }

  /**
   * Drag-and-drop reordering. Sparse positions make this one write; when the
   * gap runs out the list is queued for renumbering and the move is retried
   * by the person, rather than the whole list being rewritten inside a drag.
   */
  async move({ params, request, response, session, organization, bouncer }: HttpContext) {
    const todo = await todos.find(organization, params.id)

    if (!todo) {
      return response.status(404).json({ error: 'not_found' })
    }

    await bouncer.with('TodoPolicy').authorize('update', todo)

    const { before, after } = await request.validateUsing(moveTodoValidator)

    try {
      await todos.move(todo, before ?? null, after ?? null)
    } catch (error) {
      if (error instanceof TodoError && error.reason === 'needs_renumbering') {
        await queue.dispatch(normalizePositionsJob, { listId: todo.todoListId })

        if (request.accepts(['json'])) {
          return response.status(409).json({ error: 'needs_renumbering' })
        }

        session.flash('error', error.message)
        await todo.load('todoList')
        return response.redirect().toRoute('lists.show', { id: todo.todoList.publicId })
      }
      throw error
    }

    if (request.accepts(['json'])) {
      return response.json({ ok: true, position: todo.position })
    }

    await todo.load('todoList')
    return response.redirect().toRoute('lists.show', { id: todo.todoList.publicId })
  }

  /**
   * A date arrives as `YYYY-MM-DD` from a date input, and means "end of that
   * day where the workspace is", not "midnight UTC" — otherwise a due date
   * set in Auckland is overdue before the day starts (plan §5.6).
   */
  private parseDueDate(value: string | null | undefined, timezone: string): DateTime | null {
    if (!value) {
      return null
    }

    const parsed = DateTime.fromISO(value, { zone: timezone || 'UTC' })

    return parsed.isValid ? parsed.endOf('day').toUTC() : null
  }
}
