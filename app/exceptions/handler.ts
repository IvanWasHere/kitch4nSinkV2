import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { errors as vineErrors } from '@vinejs/vine'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import type { StatusPageRange, StatusPageRenderer } from '@adonisjs/core/types/http'

import { ApiException, apiErrorBody, type ApiErrorCode } from '#api/errors'
import UpgradeRequiredException from '#exceptions/upgrade_required_exception'
import PlanLimitExceededException from '#exceptions/plan_limit_exceeded_exception'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * Status pages are used to display a custom HTML pages for certain error
   * codes. You might want to enable them in production only, but feel
   * free to enable them in production as well.
   */
  protected renderStatusPages = app.inProduction

  /**
   * Status pages is a collection of error code range and a callback
   * to return the HTML contents to send as a response.
   */
  protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
    '404': (error, { view }) => {
      return view.render('pages/errors/not_found', { error })
    },
    '500..599': (error, { view }) => {
      return view.render('pages/errors/server_error', { error })
    },
  }

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    /**
     * The API answers JSON for everything, in one shape (plan §11).
     *
     * Decided by the **URL**, not by an `Accept` header: a client that
     * forgets the header still gets JSON rather than an HTML error page, and
     * a debug stack trace is never rendered into somebody's integration log.
     */
    if (this.isApiRequest(ctx)) {
      return this.handleApiError(error, ctx)
    }

    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }

  private isApiRequest(ctx: HttpContext): boolean {
    return ctx.request.url().startsWith('/api/')
  }

  /**
   * Everything the API can refuse, mapped onto its own error vocabulary.
   *
   * The `code` is the contract an integration branches on, so each of these
   * is deliberate rather than derived from a status: `402` alone cannot tell
   * a client whether to upgrade a plan or delete some rows.
   */
  private async handleApiError(error: unknown, ctx: HttpContext) {
    if (error instanceof ApiException) {
      return ctx.response
        .status(error.status)
        .send(apiErrorBody(error.apiCode, error.message, error.details))
    }

    /**
     * The one genuinely unusual API behaviour, and the reason it is
     * documented prominently: a `402` here is a **stop signal**, not
     * something to retry (plan §11).
     */
    if (error instanceof PlanLimitExceededException) {
      return ctx.response.status(402).send(
        apiErrorBody('plan_limit_exceeded', error.message, {
          limit: error.details.limit,
          allowed: error.details.allowed,
          current: error.details.current,
          upgrade_url: error.upgradeUrl,
        })
      )
    }

    if (error instanceof UpgradeRequiredException) {
      return ctx.response.status(402).send(
        apiErrorBody('upgrade_required', error.message, {
          feature: error.feature,
          upgrade_url: error.upgradeUrl,
        })
      )
    }

    /**
     * VineJS reports every failing field at once, which is what a client
     * needs to fix a payload in one round trip rather than one field per
     * request.
     */
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      return ctx.response
        .status(422)
        .send(apiErrorBody('validation_failed', 'The request body is not valid.', error.messages))
    }

    const status = this.statusOf(error)

    if (status === 404) {
      return ctx.response
        .status(404)
        .send(apiErrorBody('not_found', 'That endpoint does not exist.'))
    }

    if (status < 500) {
      return ctx.response
        .status(status)
        .send(apiErrorBody(this.codeFor(status), this.messageOf(error) ?? 'Request refused.'))
    }

    /**
     * A bug. Logged in full with the request id the client was given, and
     * answered with nothing else: a stack trace in an API response is a
     * disclosure, and the id is what makes support able to find it anyway.
     */
    logger.error(
      { err: error, requestId: ctx.response.getHeader('x-request-id') },
      'unhandled API error'
    )

    return ctx.response
      .status(500)
      .send(
        apiErrorBody(
          'server_error',
          'Something went wrong on our side. Quote the x-request-id header to support.'
        )
      )
  }

  private statusOf(error: unknown): number {
    const status = (error as { status?: unknown })?.status

    return typeof status === 'number' && status >= 400 && status < 600 ? status : 500
  }

  private messageOf(error: unknown): string | null {
    const message = (error as { message?: unknown })?.message

    return typeof message === 'string' ? message : null
  }

  private codeFor(status: number): ApiErrorCode {
    if (status === 401) {
      return 'unauthorized'
    }

    if (status === 403) {
      return 'forbidden'
    }

    if (status === 422) {
      return 'validation_failed'
    }

    if (status === 429) {
      return 'rate_limit_exceeded'
    }

    return 'server_error'
  }
}
