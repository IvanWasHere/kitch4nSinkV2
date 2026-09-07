import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import plans from '#billing/plan_service'
import { sendItem, sendPage } from '#api/responses'
import { decodeCursor, pageSize, toCursorPage } from '#api/cursor'
import { requireScope } from '#middleware/api_key_auth'
import MemberTransformer from '#transformers/member_transformer'
import OrganizationTransformer from '#transformers/organization_transformer'

/**
 * `GET /api/v1/organization` and `GET /api/v1/members` (plan §11).
 *
 * The first exists so an integration can **check headroom before a bulk
 * import** rather than meeting the ceiling as a 402 halfway through; the
 * second so it can resolve a name to an id it may assign work to.
 */
export default class ApiOrganizationController {
  /**
   * No scope required. It reports the calling key's own workspace and its
   * limits — a key that cannot read this could not size a request it is
   * already allowed to make, and there is nothing here it does not already
   * know by being used.
   */
  async show(ctx: HttpContext) {
    const usage = await plans.usage(ctx.organization)

    return sendItem(ctx, OrganizationTransformer.transform(ctx.organization, usage))
  }

  async members(ctx: HttpContext) {
    requireScope(ctx, 'members:read')

    const limit = pageSize(ctx.request.input('limit'))
    const after = decodeCursor(ctx.request.input('cursor'))

    const query = User.query()
      .where('organization_id', ctx.organization.id)
      .whereNull('deleted_at')
      .orderBy('id', 'asc')
      .limit(limit + 1)

    if (after) {
      query.where('id', '>', after)
    }

    const page = toCursorPage(await query, limit)

    return sendPage(ctx, MemberTransformer.transform(page.rows), {
      nextCursor: page.nextCursor,
      limit,
    })
  }
}
