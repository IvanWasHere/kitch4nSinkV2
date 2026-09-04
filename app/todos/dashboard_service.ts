import { DateTime } from 'luxon'

import Todo from '#models/todo'
import TodoList from '#models/todo_list'
import type Organization from '#models/organization'

export interface DashboardStats {
  lists: number
  openTodos: number
  completedThisWeek: number
  overdue: number
}

/**
 * The Overview screen's numbers (plan §13.5).
 *
 * The mockup's four stat cards become Lists / Open todos / Completed this
 * week / Overdue. "Completed this week" is free because completion is a
 * timestamp rather than a boolean (plan §5.6).
 */
export class DashboardService {
  async statsFor(organization: Organization): Promise<DashboardStats> {
    const [lists] = await TodoList.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .whereNull('archived_at')
      .count('* as total')

    const [openTodos] = await Todo.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .whereNull('completed_at')
      .count('* as total')

    /**
     * Dates are compared in memory rather than in SQL: a timestamp comparison
     * against a bound value means different things on SQLite and Postgres
     * (see CONTRIBUTING). These sets are a single workspace's todos.
     */
    const completed = await Todo.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .whereNotNull('completed_at')

    const weekAgo = DateTime.utc().minus({ days: 7 })

    const dueTodos = await Todo.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .whereNull('completed_at')
      .whereNotNull('due_at')

    return {
      lists: Number(lists.$extras.total),
      openTodos: Number(openTodos.$extras.total),
      completedThisWeek: completed.filter((todo) => todo.completedAt! >= weekAgo).length,
      overdue: dueTodos.filter((todo) => todo.isOverdue).length,
    }
  }

  /**
   * The mockup's "recent orders" table becomes recent todos (plan §13.6.2).
   */
  async recentTodos(organization: Organization, limit = 6): Promise<Todo[]> {
    return Todo.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .preload('todoList')
      .preload('assignedTo')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
  }

  /**
   * The activity feed, from what has actually happened to todos.
   */
  async recentActivity(organization: Organization, limit = 6): Promise<Todo[]> {
    return Todo.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
      .whereNotNull('completed_at')
      .preload('todoList')
      .preload('completedBy')
      .orderBy('completed_at', 'desc')
      .limit(limit)
  }
}

export default new DashboardService()
