import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type User from '#models/user'
import type Organization from '#models/organization'

/**
 * Who may manage the people in an organisation (plan §6).
 */
export default class MemberPolicy extends BasePolicy {
  private sameOrganization(user: User, other: User): boolean {
    return user.organizationId === other.organizationId
  }

  /**
   * Every member sees the whole team — lists and todos belong to the
   * organisation, so knowing who else is in it is not privileged (D8).
   */
  viewAny(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id
  }

  invite(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id && user.isOwner
  }

  /**
   * Removing someone destroys their access to shared work, so it is
   * owner-only — and the owner cannot remove themselves, because that would
   * leave the workspace with nobody who can pay for it.
   */
  remove(user: User, target: User, organization: Organization): AuthorizerResponse {
    return (
      user.organizationId === organization.id &&
      this.sameOrganization(user, target) &&
      user.isOwner &&
      target.id !== organization.ownerId
    )
  }

  /**
   * Anyone but the owner may leave on their own. The owner transfers
   * ownership or deletes the workspace instead.
   */
  leave(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id && user.id !== organization.ownerId
  }
}
