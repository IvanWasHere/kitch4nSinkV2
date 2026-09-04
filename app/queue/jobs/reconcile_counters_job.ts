import logger from '@adonisjs/core/services/logger'

import Todo from '#models/todo'
import TodoList from '#models/todo_list'
import type { JobHandler } from '#queue/contracts'

/**
 * Recomputes every list's `todos_count` and reports drift (plan §5.5).
 *
 * It **alerts rather than repairs**. The counter is only ever written inside
 * the same transaction as the insert or delete it accounts for, so drift can
 * only mean a bug — and a job that quietly fixes the number every night is a
 * job that hides that bug forever. The corrected value is written so the
 * product stays usable; the log line is the part that matters.
 */
class ReconcileCountersJob implements JobHandler {
  readonly name = 'reconcile_counters'

  async handle() {
    const lists = await TodoList.query().whereNull('deleted_at')

    let drifted = 0

    for (const list of lists) {
      const [counted] = await Todo.query()
        .where('todo_list_id', list.id)
        .whereNull('deleted_at')
        .count('* as total')

      const actual = Number(counted.$extras.total)

      if (actual === list.todosCount) {
        continue
      }

      drifted++

      logger.error(
        {
          listId: list.id,
          publicId: list.publicId,
          organizationId: list.organizationId,
          stored: list.todosCount,
          actual,
        },
        'todos_count drifted — the counter is only written inside the insert transaction, so this is a bug'
      )

      list.todosCount = actual
      await list.save()
    }

    logger.info({ lists: lists.length, drifted }, 'reconciled todo counters')
  }
}

export default new ReconcileCountersJob()
