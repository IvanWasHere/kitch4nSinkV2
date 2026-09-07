import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import Todo from '#models/todo'
import type User from '#models/user'
import TodoList from '#models/todo_list'
import type Organization from '#models/organization'
import plans from '#billing/plan_service'
import { nextPosition } from '#todos/position'

export type ListColor = 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'gray'

export interface CreateListData {
  name: string
  description?: string | null
  color?: ListColor
}

export class ListError extends Error {
  constructor(
    message: string,
    readonly reason: 'duplicate_name'
  ) {
    super(message)
  }
}

/**
 * Lists belong to the organisation (D8). Every method here therefore takes
 * the organisation and scopes by it — there is no "my lists".
 *
 * `create` is the one place the `lists` quota is enforced (plan §7.4), and it
 * is enforced *inside* the transaction that does the insert.
 */
export class ListService {
  /**
   * Lists a member sees, newest ordering first. Archived lists are hidden by
   * default but still exist — and still count against the quota, so archiving
   * cannot be used to dodge the cap (plan §5.6).
   */
  async forOrganization(
    organization: Organization,
    options: { includeArchived?: boolean } = {}
  ): Promise<TodoList[]> {
    const query = TodoList.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .preload('createdBy')
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')

    if (!options.includeArchived) {
      query.whereNull('archived_at')
    }

    return query
  }

  /**
   * A single list, scoped to the organisation.
   *
   * Tenancy is part of the lookup rather than a check after it, so a list id
   * belonging to another workspace behaves exactly like one that does not
   * exist.
   */
  async find(organization: Organization, publicId: string): Promise<TodoList | null> {
    return TodoList.query()
      .where('public_id', publicId)
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .first()
  }

  /**
   * Create a list, if the plan has room for one.
   *
   * The quota check is the first thing inside the transaction and it locks
   * the organisation row (plan §7.4): a plain count-then-insert lets two
   * simultaneous requests both read 2 against a three-list plan and both
   * insert. Archived lists are counted, so archiving cannot be used to dodge
   * the cap; soft-deleted ones are not, so deleting genuinely frees a slot.
   */
  async create(organization: Organization, actor: User, data: CreateListData): Promise<TodoList> {
    return db.transaction(async (trx) => {
      await plans.lockAndAssertLimit(trx, organization, 'lists', (client) =>
        plans.listCount(organization, client)
      )

      await this.assertNameIsFree(organization, data.name, trx)

      const positions = await this.currentPositions(organization, trx)

      return TodoList.create(
        {
          organizationId: organization.id,
          createdByUserId: actor.id,
          name: data.name.trim(),
          description: data.description?.trim() || null,
          color: data.color ?? 'blue',
          position: nextPosition(positions),
          todosCount: 0,
        },
        { client: trx }
      )
    })
  }

  async rename(
    organization: Organization,
    list: TodoList,
    data: CreateListData
  ): Promise<TodoList> {
    return db.transaction(async (trx) => {
      await this.assertNameIsFree(organization, data.name, trx, list.id)

      list.useTransaction(trx)
      list.name = data.name.trim()
      list.description = data.description?.trim() || null
      if (data.color) {
        list.color = data.color
      }
      await list.save()

      return list
    })
  }

  /**
   * Hide a list without losing anything. Reversible, available to any member,
   * and the list keeps its seat against the `lists` quota (plan §5.6).
   */
  async archive(list: TodoList): Promise<void> {
    list.archivedAt = DateTime.utc()
    await list.save()
  }

  async unarchive(list: TodoList): Promise<void> {
    list.archivedAt = null
    await list.save()
  }

  /**
   * Soft-delete a list and everything in it. Owner-only (plan §6): it is the
   * one destructive action a member could take against shared work, and
   * archiving is the member-safe equivalent.
   *
   * Both happen in one transaction, so a list can never be gone while its
   * todos are still countable.
   */
  async delete(list: TodoList): Promise<void> {
    await db.transaction(async (trx) => {
      const deletedAt = DateTime.utc()

      await Todo.query({ client: trx })
        .where('todo_list_id', list.id)
        .whereNull('deleted_at')
        .update({ deleted_at: deletedAt.toSQL() })

      list.useTransaction(trx)
      list.deletedAt = deletedAt
      await list.save()
    })
  }

  /**
   * Move a list to a new place in the manual order.
   */
  async reorder(organization: Organization, list: TodoList, position: number): Promise<void> {
    list.position = position
    await list.save()

    void organization
  }

  private async currentPositions(
    organization: Organization,
    trx: TransactionClientContract
  ): Promise<number[]> {
    const lists = await TodoList.query({ client: trx })
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .select('position')

    return lists.map((list) => list.position)
  }

  /**
   * Plan §5.2 wants `unique(organization_id, name)` among non-deleted rows.
   * SQLite has no partial indexes (portability rule 5), so the rule is
   * enforced here, inside the transaction that is about to write the name.
   */
  private async assertNameIsFree(
    organization: Organization,
    name: string,
    trx: TransactionClientContract,
    exceptListId?: number
  ): Promise<void> {
    const query = TodoList.query({ client: trx })
      .where('organization_id', organization.id)
      .where('name', name.trim())
      .whereNull('deleted_at')

    if (exceptListId) {
      query.whereNot('id', exceptListId)
    }

    if (await query.first()) {
      throw new ListError(
        `This workspace already has a list called "${name.trim()}".`,
        'duplicate_name'
      )
    }
  }
}

export default new ListService()
