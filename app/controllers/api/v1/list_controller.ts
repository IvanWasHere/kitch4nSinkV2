import type { HttpContext } from '@adonisjs/core/http'

import TodoList from '#models/todo_list'
import lists, { ListError } from '#todos/list_service'
import { requireScope } from '#middleware/api_key_auth'
import { ApiNotFoundException, ApiValidationException } from '#api/errors'
import { decodeCursor, pageSize, toCursorPage } from '#api/cursor'
import { sendItem, sendPage } from '#api/responses'
import TodoListTransformer from '#transformers/todo_list_transformer'
import { apiCreateListValidator, apiUpdateListValidator } from '#validators/api'

/**
 * `/api/v1/lists` (plan §11).
 *
 * Every query is scoped by `ctx.organization.id`, which the API key
 * establishes — no endpoint accepts an organisation id, so there is nothing
 * for a caller to forge.
 *
 * Scopes are checked at the top of each action rather than declared on the
 * route, so the requirement sits next to the code it guards.
 */
export default class ApiListController {
  async index(ctx: HttpContext) {
    requireScope(ctx, 'lists:read')

    const { request, organization } = ctx
    const limit = pageSize(request.input('limit'))
    const after = decodeCursor(request.input('cursor'))

    const query = TodoList.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      /**
       * Ordered by id, which is also what the cursor is: any other ordering
       * would need the sort key in the cursor too, and `position` is not
       * unique.
       */
      .orderBy('id', 'asc')
      .limit(limit + 1)

    if (after) {
      query.where('id', '>', after)
    }

    /**
     * `archived` is tri-state on purpose: absent means "only live ones",
     * which is what a client syncing active work wants; `archived=true`
     * narrows to archived; `archived=all` takes everything. Defaulting to
     * "everything" would quietly include work a customer put away.
     */
    const archived = String(request.input('archived', '')).toLowerCase()

    if (archived === 'true' || archived === '1') {
      query.whereNotNull('archived_at')
    } else if (archived !== 'all') {
      query.whereNull('archived_at')
    }

    const page = toCursorPage(await query, limit)

    return sendPage(ctx, TodoListTransformer.transform(page.rows), {
      nextCursor: page.nextCursor,
      limit,
    })
  }

  async show(ctx: HttpContext) {
    requireScope(ctx, 'lists:read')

    return sendItem(ctx, TodoListTransformer.transform(await this.findOrFail(ctx)))
  }

  /**
   * `402 plan_limit_exceeded` when the workspace is at its `lists` cap — the
   * one genuinely unusual thing about this API, and the reason
   * `GET /organization` exists (plan §7.4, §11).
   *
   * The exception is not caught here: the handler renders it with the numbers
   * and the upgrade URL, identically for every endpoint.
   */
  async store(ctx: HttpContext) {
    requireScope(ctx, 'lists:write')

    const payload = await ctx.request.validateUsing(apiCreateListValidator)

    try {
      const list = await lists.create(ctx.organization, await this.actorFor(ctx), {
        name: payload.name,
        description: payload.description ?? null,
        color: payload.color,
      })

      return sendItem(ctx, TodoListTransformer.transform(list), 201)
    } catch (error) {
      if (error instanceof ListError) {
        throw new ApiValidationException({ name: [error.message] }, error.message)
      }
      throw error
    }
  }

  async update(ctx: HttpContext) {
    requireScope(ctx, 'lists:write')

    const list = await this.findOrFail(ctx)
    const payload = await ctx.request.validateUsing(apiUpdateListValidator)

    try {
      if (payload.name !== undefined || payload.description !== undefined || payload.color) {
        await lists.rename(ctx.organization, list, {
          name: payload.name ?? list.name,
          description: payload.description === undefined ? list.description : payload.description,
          color: payload.color,
        })
      }
    } catch (error) {
      if (error instanceof ListError) {
        throw new ApiValidationException({ name: [error.message] }, error.message)
      }
      throw error
    }

    if (payload.archived !== undefined) {
      /**
       * Idempotent: `archived: true` on an already-archived list is a
       * success, because a client retrying after a timeout must not fail.
       */
      if (payload.archived && !list.isArchived) {
        await lists.archive(list)
      } else if (!payload.archived && list.isArchived) {
        await lists.unarchive(list)
      }
    }

    return sendItem(ctx, TodoListTransformer.transform(list))
  }

  /**
   * Deleting takes every todo inside with it, which is why the web app makes
   * it owner-only (plan §6). A key is not a user, so the API expresses the
   * same caution through the `lists:write` scope — a read-only key cannot do
   * it, and granting write is a deliberate act (plan §11).
   */
  async destroy(ctx: HttpContext) {
    requireScope(ctx, 'lists:write')

    const list = await this.findOrFail(ctx)
    await lists.delete(list)

    return ctx.response.noContent()
  }

  private async findOrFail(ctx: HttpContext): Promise<TodoList> {
    const list = await lists.find(ctx.organization, ctx.params.id)

    /**
     * Tenancy is in the lookup, so another organisation's id is
     * indistinguishable from one that never existed.
     */
    if (!list) {
      throw new ApiNotFoundException('That list does not exist.')
    }

    return list
  }

  /**
   * A key has no user, but `created_by_user_id` is provenance the UI shows.
   * The key's creator stands in — it is the closest true answer, and the
   * alternative is a null that makes every API-created row look ownerless.
   */
  private async actorFor(ctx: HttpContext) {
    const { default: User } = await import('#models/user')

    const creator = ctx.apiKey?.createdByUserId
      ? await User.query()
          .where('id', ctx.apiKey.createdByUserId)
          .where('organization_id', ctx.organization.id)
          .first()
      : null

    return (
      creator ??
      (await User.query()
        .where('organization_id', ctx.organization.id)
        .where('role', 'owner')
        .firstOrFail())
    )
  }
}
