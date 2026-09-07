import { Exception } from '@adonisjs/core/exceptions'

/**
 * The API's error vocabulary (plan §11).
 *
 * One shape, RFC 7807-ish:
 *
 *   { "error": { "code": "not_found", "message": "…", "details": … } }
 *
 * `code` is the contract. An integration branches on it, so these strings are
 * as permanent as a column name — the message is for a human reading a log and
 * may be reworded freely.
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'insufficient_scope'
  | 'not_found'
  | 'validation_failed'
  | 'plan_limit_exceeded'
  | 'upgrade_required'
  | 'rate_limit_exceeded'
  | 'server_error'

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    details?: unknown
  }
}

export function apiErrorBody(code: ApiErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } }
}

/**
 * Anything the API refuses, with a status and a machine code chosen together.
 */
export class ApiException extends Exception {
  constructor(
    readonly apiCode: ApiErrorCode,
    message: string,
    status: number,
    readonly details?: unknown
  ) {
    super(message, { status, code: `E_API_${apiCode.toUpperCase()}` })
  }
}

/**
 * No credentials, or credentials we do not recognise.
 *
 * Deliberately indistinguishable from a revoked or expired key: telling those
 * apart would let somebody probe whether a key they found is still live.
 */
export class ApiUnauthorizedException extends ApiException {
  constructor(message = 'A valid API key is required.') {
    super('unauthorized', message, 401)
  }
}

/**
 * A real key that may not do this.
 *
 * 403 with the missing scope named, because the fix is for the customer to
 * mint a key with that scope — and an error that does not say which one turns
 * that into guesswork.
 */
export class ApiInsufficientScopeException extends ApiException {
  constructor(readonly scope: string) {
    super('insufficient_scope', `This API key does not have the "${scope}" scope.`, 403, {
      required_scope: scope,
    })
  }
}

export class ApiNotFoundException extends ApiException {
  /**
   * The same answer for "does not exist" and "belongs to another
   * organisation" (plan tenancy rules). Anything else leaks which public ids
   * are real.
   */
  constructor(message = 'That resource does not exist.') {
    super('not_found', message, 404)
  }
}

export class ApiValidationException extends ApiException {
  constructor(details: unknown, message = 'The request body is not valid.') {
    super('validation_failed', message, 422, details)
  }
}
