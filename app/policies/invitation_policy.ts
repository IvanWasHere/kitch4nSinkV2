import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type User from '#models/user'
import type Invitation from '#models/invitation'

/**
 * Invitations are managed by the owner, and only within their own
 * organisation — an invitation id from another workspace must be a 403, not
 * a successful revoke.
 */
export default class InvitationPolicy extends BasePolicy {
  viewAny(user: User): AuthorizerResponse {
    return user.isOwner
  }

  revoke(user: User, invitation: Invitation): AuthorizerResponse {
    return user.isOwner && user.organizationId === invitation.organizationId
  }

  resend(user: User, invitation: Invitation): AuthorizerResponse {
    return this.revoke(user, invitation)
  }
}
