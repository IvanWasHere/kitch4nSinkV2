import { compose } from '@adonisjs/core/helpers'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'

import Todo from '#models/todo'
import User from '#models/user'
import Organization from '#models/organization'
import { TodoListSchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'
import { withSoftDelete } from '#models/mixins/with_soft_delete'

/**
 * A shared list (D8).
 *
 * It belongs to the organisation, not to its author: every member sees every
 * list, and `createdBy` is provenance for the UI only (plan §5.6).
 */
export default class TodoList extends compose(
  TodoListSchema,
  withPublicId('todoList'),
  withSoftDelete
) {
  @belongsTo(() => Organization)
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'createdByUserId' })
  declare createdBy: BelongsTo<typeof User>

  @hasMany(() => Todo)
  declare todos: HasMany<typeof Todo>

  get isArchived() {
    return Boolean(this.archivedAt)
  }
}
