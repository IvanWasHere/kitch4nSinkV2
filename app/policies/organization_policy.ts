import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type User from '#models/user'
import type Organization from '#models/organization'

/**
 * Who may do what to an organisation (D7, plan §6).
 *
 * Every method takes the actor explicitly rather than reading `auth.user`.
 * That is what lets the same policy answer for an API-key actor (M6) and for
 * a staff member impersonating a tenant (M7) — an implicit actor would mean a
 * second, divergent set of checks for each.
 */
export default class OrganizationPolicy extends BasePolicy {
  /**
   * The rule underneath every other rule: an actor may only ever touch their
   * own organisation. Tenancy is checked here, not remembered at call sites.
   */
  private belongsTo(user: User, organization: Organization): boolean {
    return user.organizationId === organization.id
  }

  view(user: User, organization: Organization): AuthorizerResponse {
    return this.belongsTo(user, organization)
  }

  /**
   * Renaming the workspace, changing its timezone: owner-only, because it is
   * what every member sees and what appears on invoices.
   */
  update(user: User, organization: Organization): AuthorizerResponse {
    return this.belongsTo(user, organization) && user.isOwner
  }

  /**
   * Deleting takes the whole workspace with it, so only the owner can, and
   * the UI asks them to type its name first (plan §13.6.3).
   */
  delete(user: User, organization: Organization): AuthorizerResponse {
    return this.belongsTo(user, organization) && user.id === organization.ownerId
  }

  transferOwnership(user: User, organization: Organization): AuthorizerResponse {
    return this.belongsTo(user, organization) && user.id === organization.ownerId
  }

  /**
   * Billing, checkout, the plan grid and invoices — owner-only (plan §6),
   * which is also why the nav hides them for members.
   */
  manageBilling(user: User, organization: Organization): AuthorizerResponse {
    return this.belongsTo(user, organization) && user.isOwner
  }
}
