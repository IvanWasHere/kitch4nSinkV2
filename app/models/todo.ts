import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import TodoList from '#models/todo_list'
import Organization from '#models/organization'
import { TodoSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'
import { withSoftDelete } from '#models/mixins/with_soft_delete'

export default class Todo extends compose(TodoSchema, withPublicId('todo'), withSoftDelete) {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => TodoList)
  declare todoList: BelongsTo<typeof TodoList>

  @belongsTo(() => User, { foreignKey: 'createdByUserId' })
  declare createdBy: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'assignedToUserId' })
  declare assignedTo: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'completedByUserId' })
  declare completedBy: BelongsTo<typeof User>

  /**
   * Completion is a timestamp, so this is derived rather than stored — one
   * source of truth, and "completed this week" comes free (plan §5.6).
   */
  get isComplete() {
    return Boolean(this.completedAt)
  }

  /**
   * Past its due date and not yet done. A completed todo is never overdue,
   * however late it was finished.
   */
  get isOverdue() {
    return Boolean(this.dueAt) && !this.isComplete && this.dueAt! <= DateTime.utc()
  }

  get isDueToday() {
    return Boolean(this.dueAt) && !this.isComplete && this.dueAt! <= DateTime.utc().endOf('day')
  }
}
