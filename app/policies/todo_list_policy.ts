import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type User from '#models/user'
import type TodoList from '#models/todo_list'
import type Organization from '#models/organization'

/**
 * Lists belong to the organisation (D8), so "can this person see it" is
 * entirely a question of which organisation they are in — never of who
 * created it. `createdByUserId` is provenance for the UI and must not appear
 * in any check here.
 */
export default class TodoListPolicy extends BasePolicy {
  private inOrganization(user: User, list: TodoList): boolean {
    return user.organizationId === list.organizationId
  }

  viewAny(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id
  }

  view(user: User, list: TodoList): AuthorizerResponse {
    return this.inOrganization(user, list)
  }

  create(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id
  }

  update(user: User, list: TodoList): AuthorizerResponse {
    return this.inOrganization(user, list)
  }

  /**
   * Archiving is the member-safe half of removing a list: reversible, and it
   * keeps the list's seat against the quota (plan §5.6).
   */
  archive(user: User, list: TodoList): AuthorizerResponse {
    return this.inOrganization(user, list)
  }

  /**
   * Deleting cascades to every todo inside, which makes it the one
   * destructive action a member could take against shared work — so it is
   * owner-only (plan §6).
   */
  delete(user: User, list: TodoList): AuthorizerResponse {
    return this.inOrganization(user, list) && user.isOwner
  }
}
