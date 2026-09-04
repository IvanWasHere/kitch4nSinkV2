import vine from '@vinejs/vine'

const LIST_COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'gray'] as const
const PRIORITIES = ['low', 'normal', 'high'] as const

export const createListValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(120),
  description: vine.string().trim().maxLength(500).nullable().optional(),
  color: vine.enum(LIST_COLORS).optional(),
})

/**
 * `assignedTo` carries a member's public id, not an internal one. Whether that
 * member is in the caller's organisation is decided by TodoService — a
 * validator that queried the session would be authorisation in the wrong
 * place (plan §5.6).
 */
export const createTodoValidator = vine.create({
  title: vine.string().trim().minLength(1).maxLength(200),
  notes: vine.string().trim().maxLength(2000).nullable().optional(),
  priority: vine.enum(PRIORITIES).optional(),
  dueAt: vine.string().trim().nullable().optional(),
  assignedTo: vine.string().trim().nullable().optional(),
})

export const moveTodoValidator = vine.create({
  before: vine.string().trim().nullable().optional(),
  after: vine.string().trim().nullable().optional(),
})
