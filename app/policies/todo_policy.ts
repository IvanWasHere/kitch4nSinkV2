import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type Todo from '#models/todo'
import type User from '#models/user'
import type TodoList from '#models/todo_list'

/**
 * Every member may create, edit, complete, assign and delete todos (plan §6).
 * The only question each method asks is whether the actor is in the same
 * organisation as the row.
 */
export default class TodoPolicy extends BasePolicy {
  private inOrganization(user: User, todo: Todo): boolean {
    return user.organizationId === todo.organizationId
  }

  create(user: User, list: TodoList): AuthorizerResponse {
    /**
     * An archived list is read-only: it has been put away, and adding to it
     * would be a surprising way to un-archive it.
     */
    return user.organizationId === list.organizationId && !list.isArchived
  }

  view(user: User, todo: Todo): AuthorizerResponse {
    return this.inOrganization(user, todo)
  }

  update(user: User, todo: Todo): AuthorizerResponse {
    return this.inOrganization(user, todo)
  }

  complete(user: User, todo: Todo): AuthorizerResponse {
    return this.inOrganization(user, todo)
  }

  /**
   * Unlike deleting a *list*, deleting one todo is not owner-only: it is a
   * single item, recoverable, and gating it would make the product tedious
   * for no safety gain.
   */
  delete(user: User, todo: Todo): AuthorizerResponse {
    return this.inOrganization(user, todo)
  }
}
