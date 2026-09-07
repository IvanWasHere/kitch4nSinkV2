import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type User from '#models/user'
import type ApiKey from '#models/api_key'
import type Organization from '#models/organization'

/**
 * API keys are owner-only (D4, plan §6).
 *
 * Not an arbitrary restriction: a key can consume the organisation's entire
 * monthly call allowance and can be granted write access to every list, so it
 * belongs with billing rather than with the things any member may do. The
 * route group gates the whole area; this decides the individual actions.
 */
export default class ApiKeyPolicy extends BasePolicy {
  viewAny(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id && user.isOwner
  }

  create(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id && user.isOwner
  }

  /**
   * Revoking is available to any owner, not only the key's creator: the
   * person who needs to kill a leaked key at 3am is whoever is awake.
   */
  revoke(user: User, apiKey: ApiKey): AuthorizerResponse {
    return user.organizationId === apiKey.organizationId && user.isOwner
  }
}
