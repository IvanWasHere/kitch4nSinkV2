import vine from '@vinejs/vine'

import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '#modules/content/services/slugs'

/**
 * The post and page form. Whether a slug is *free* — not reserved, not
 * another entry's, not somebody's old slug — needs the database and the route
 * table, so `ContentService` decides that; this only checks its shape.
 */
export const contentValidator = vine.create({
  title: vine.string().trim().minLength(1).maxLength(200),
  slug: vine
    .string()
    .trim()
    .toLowerCase()
    .maxLength(SLUG_MAX_LENGTH)
    .regex(SLUG_PATTERN)
    .nullable()
    .optional(),
  excerpt: vine.string().trim().maxLength(500).nullable().optional(),
  body: vine.string().trim().minLength(1).maxLength(100_000),

  /**
   * From a `datetime-local` input, read as UTC. Parsed in the controller,
   * like the announcement form's date.
   */
  publishedAt: vine.string().trim().nullable().optional(),
})
