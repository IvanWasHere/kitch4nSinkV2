import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import ApiRequest from '#models/api_request'

/**
 * Records every API request and echoes an `X-Request-Id` (plan §11).
 *
 * The header is the point. When a customer says "your API failed at half past
 * two", the only useful reply is "quote me the request id", and that only
 * works if the id is on the response *and* in our table.
 *
 * Runs **outside** everything else in the stack so a 401 from the auth
 * middleware and a 402 from a quota are recorded too — those are exactly the
 * responses somebody will be asking about.
 */
export default class TrackApiUsageMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const startedAt = process.hrtime.bigint()

    /**
     * Reuse the client's id when it sent one, so a request can be traced
     * across their system and ours.
     */
    const requestId = ctx.request.header('x-request-id') ?? randomUUID()
    ctx.response.header('x-request-id', requestId)

    try {
      return await next()
    } finally {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n)

      /**
       * Not awaited, and never allowed to throw: logging a request must not
       * be able to fail the request it is logging, or delay a response the
       * customer is waiting for.
       */
      void this.record(ctx, requestId, durationMs).catch((error) => {
        logger.error({ err: error, requestId }, 'could not record an API request')
      })
    }
  }

  private async record(ctx: HttpContext, requestId: string, durationMs: number): Promise<void> {
    /**
     * An unauthenticated request has no organisation to attribute, and a row
     * per unauthenticated call would be a free write endpoint for anybody who
     * found the URL.
     */
    if (!ctx.organization) {
      return
    }

    await ApiRequest.create({
      organizationId: ctx.organization.id,
      apiKeyId: ctx.apiKey?.id ?? null,
      requestId,
      method: ctx.request.method(),
      /**
       * The path only — a query string can carry a cursor or a filter, and
       * neither belongs in a table support reads over somebody's shoulder.
       */
      path: ctx.request.url().slice(0, 512),
      status: ctx.response.getStatus(),
      durationMs,
      ip: ctx.request.ip(),
      createdAt: DateTime.utc(),
    })
  }
}
