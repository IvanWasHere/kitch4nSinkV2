import vine from '@vinejs/vine'

import { API_SCOPES } from '#api/scopes'

const LIST_COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'gray'] as const
const PRIORITIES = ['low', 'normal', 'high'] as const

/**
 * Request bodies for the organisation API (plan §11).
 *
 * Separate from `#validators/todo` even though the fields overlap, because
 * the two have different contracts: the web form takes `assignedTo` from a
 * `<select>` and may change shape with the UI, while these are a published
 * interface where renaming a field breaks somebody's integration.
 *
 * Keys are snake_case, matching what the transformers emit — a client should
 * be able to `PATCH` back a field it just read.
 */
export const apiCreateListValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(120),
  description: vine.string().trim().maxLength(500).nullable().optional(),
  color: vine.enum(LIST_COLORS).optional(),
})

export const apiUpdateListValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(120).optional(),
  description: vine.string().trim().maxLength(500).nullable().optional(),
  color: vine.enum(LIST_COLORS).optional(),

  /**
   * Archiving through the API is a field rather than a sub-resource, so a
   * client can archive and rename in one call.
   */
  archived: vine.boolean().optional(),
})

export const apiCreateTodoValidator = vine.create({
  title: vine.string().trim().minLength(1).maxLength(200),
  notes: vine.string().trim().maxLength(2000).nullable().optional(),
  priority: vine.enum(PRIORITIES).optional(),

  /**
   * ISO 8601. Strict, because a due date guessed from an ambiguous format is
   * a task that silently becomes overdue in the wrong week.
   */
  due_at: vine.string().trim().nullable().optional(),

  /**
   * A member's `public_id`. Whether that member is in the calling
   * organisation is decided by `TodoService` — a validator that queried the
   * request's own scope would be authorisation in the wrong place (§5.6).
   */
  assigned_to: vine.string().trim().nullable().optional(),
})

export const apiUpdateTodoValidator = vine.create({
  title: vine.string().trim().minLength(1).maxLength(200).optional(),
  notes: vine.string().trim().maxLength(2000).nullable().optional(),
  priority: vine.enum(PRIORITIES).optional(),
  due_at: vine.string().trim().nullable().optional(),
  assigned_to: vine.string().trim().nullable().optional(),
  position: vine.number().min(0).optional(),
})

/**
 * Creating a key from the owner's own screen (not from the API — a key
 * cannot mint another key).
 */
export const createApiKeyValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(80),
  scopes: vine.array(vine.enum(API_SCOPES)).minLength(1).optional(),
  environment: vine.enum(['live', 'test'] as const).optional(),
})
