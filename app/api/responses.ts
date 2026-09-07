import type { HttpContext } from '@adonisjs/core/http'

import serializer from '#api/serializer'

/**
 * The shape of every successful API response (plan §11).
 *
 * A single object is `{ data: {...} }`; a page is `{ data: [...], meta: {...} }`.
 * Always an envelope, never a bare array: a top-level array cannot grow a
 * `meta` key later without breaking every client, and pagination is exactly
 * the thing that eventually needs one.
 */
export async function sendItem(ctx: HttpContext, resource: unknown, status = 200): Promise<void> {
  const data = await serializer.serializeWithoutWrapping(resource as never)

  ctx.response.status(status).send({ data })
}

/**
 * A cursor page. `next_cursor` is null on the last page, which is the only
 * signal a syncing client needs to stop.
 */
export async function sendPage(
  ctx: HttpContext,
  resource: unknown,
  meta: { nextCursor: string | null; limit: number }
): Promise<void> {
  const data = await serializer.serializeWithoutWrapping(resource as never)

  ctx.response.send({
    data,
    meta: { next_cursor: meta.nextCursor, limit: meta.limit },
  })
}
