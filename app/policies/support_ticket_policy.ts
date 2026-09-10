import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type User from '#models/user'
import type Organization from '#models/organization'
import type SupportTicket from '#models/support_ticket'

/**
 * Who inside a workspace may read a support ticket (plan §21.4).
 *
 * Narrower than lists and files, which are workspace-wide by D8: a ticket can
 * carry a billing dispute, a complaint about a colleague, or a screenshot of
 * something personal. The author sees their own; owners see all of them,
 * because they are already the workspace's billing and membership authority
 * and will be answering for it anyway.
 *
 * `SupportService.scopeFor` applies the same rule in SQL. This policy is what
 * a controller checks *after* fetching one, so a scoping bug cannot become an
 * authorisation bug.
 */
export default class SupportTicketPolicy extends BasePolicy {
  viewAny(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id
  }

  /**
   * Every member may open a ticket. Support is not a paid feature and not an
   * owner-only one: the person hitting a problem is the person who should be
   * able to describe it.
   */
  create(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id
  }

  view(user: User, ticket: SupportTicket): AuthorizerResponse {
    if (user.organizationId !== ticket.organizationId) {
      return false
    }

    return user.isOwner || ticket.createdByUserId === user.id
  }

  /**
   * Replying is reading plus a body — whoever can see the conversation can
   * continue it.
   */
  reply(user: User, ticket: SupportTicket): AuthorizerResponse {
    return this.view(user, ticket)
  }
}
