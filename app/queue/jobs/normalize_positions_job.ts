import logger from '@adonisjs/core/services/logger'

import Todo from '#models/todo'
import TodoList from '#models/todo_list'
import { normalisedPositions, POSITION_GAP } from '#todos/position'
import type { JobHandler } from '#queue/contracts'

/**
 * Spreads sparse positions back out (plan §5.6).
 *
 * Dropping a row between two others halves the gap between them. After enough
 * drops in the same place the neighbours become adjacent integers and there
 * is nowhere left to insert — this restores the 100-apart spacing without
 * changing the order anyone sees.
 *
 * Idempotent: a list already evenly spaced is skipped, so running it twice
 * writes nothing the second time.
 */
class NormalizePositionsJob implements JobHandler<{ listId?: number }> {
  readonly name = 'normalize_positions'

  async handle(payload: { listId?: number }) {
    const lists = payload.listId
      ? await TodoList.query().where('id', payload.listId).whereNull('deleted_at')
      : await TodoList.query().whereNull('deleted_at')

    let renumbered = 0

    for (const list of lists) {
      const todos = await Todo.query()
        .where('todo_list_id', list.id)
        .whereNull('deleted_at')
        .orderBy('position', 'asc')
        .orderBy('id', 'asc')

      const wanted = normalisedPositions(todos.length)
      const alreadySpaced = todos.every((todo, index) => todo.position === wanted[index])

      if (alreadySpaced) {
        continue
      }

      for (const [index, todo] of todos.entries()) {
        todo.position = wanted[index]
        await todo.save()
      }

      renumbered++
    }

    if (renumbered > 0) {
      logger.info({ lists: renumbered, gap: POSITION_GAP }, 'renumbered list positions')
    }
  }
}

export default new NormalizePositionsJob()
