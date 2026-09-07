import { BaseTransformer } from '@adonisjs/core/transformers'

import type Todo from '#models/todo'

/**
 * A todo, as the API describes one (plan §11).
 *
 * `completed` is exposed as a boolean *and* `completed_at` as a timestamp:
 * the boolean is what a client branches on, the timestamp is where "completed
 * this week" comes from, and deriving one from the other is the caller's
 * choice rather than a lossy decision made here (plan §5.6).
 */
export default class TodoTransformer extends BaseTransformer<Todo> {
  toObject() {
    return {
      id: this.resource.publicId,
      list_id: this.resource.todoList?.publicId ?? null,
      title: this.resource.title,
      notes: this.resource.notes,
      priority: this.resource.priority,
      position: this.resource.position,

      due_at: this.resource.dueAt?.toUTC().toISO() ?? null,
      completed: Boolean(this.resource.completedAt),
      completed_at: this.resource.completedAt?.toUTC().toISO() ?? null,

      /**
       * A member's public id, which is exactly what `PATCH` accepts back —
       * so a client can round-trip an assignment without a lookup table.
       */
      assigned_to: this.resource.assignedTo?.publicId ?? null,
      created_at: this.resource.createdAt.toUTC().toISO(),
      updated_at: this.resource.updatedAt?.toUTC().toISO() ?? null,
    }
  }
}
