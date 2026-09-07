import { BaseTransformer } from '@adonisjs/core/transformers'

import type TodoList from '#models/todo_list'

/**
 * A list, as the API describes one (plan §11).
 *
 * Every field is named explicitly. That is the point of a transformer here:
 * adding a column to `todo_lists` must never widen the public contract by
 * accident, and an internal integer id must never leave the process — the
 * API addresses everything by `public_id` (D6).
 *
 * Keys are snake_case on the wire while the models are camelCase, so the
 * translation happens once, here, rather than in every client.
 *
 * Every timestamp goes out as `toUTC().toISO()` — i.e. `…Z`. A DateTime read
 * back from the database renders as `…+00:00` while one just created renders
 * as `…Z`, and an API that emits both formats for the same field makes a
 * client comparing strings break on a row's second read (CONTRIBUTING).
 */
export default class TodoListTransformer extends BaseTransformer<TodoList> {
  toObject() {
    return {
      id: this.resource.publicId,
      name: this.resource.name,
      description: this.resource.description,
      color: this.resource.color,
      position: this.resource.position,

      /**
       * The denormalised counter, which is also what the `todosPerList` cap
       * is checked against — so a client sizing a bulk import reads the same
       * number the 402 will.
       */
      todos_count: this.resource.todosCount,

      archived: Boolean(this.resource.archivedAt),
      archived_at: this.resource.archivedAt?.toUTC().toISO() ?? null,
      created_at: this.resource.createdAt.toUTC().toISO(),
      updated_at: this.resource.updatedAt?.toUTC().toISO() ?? null,
    }
  }
}
