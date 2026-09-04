import type { HttpContext } from '@adonisjs/core/http'

import lists, { ListError } from '#todos/list_service'
import todos from '#todos/todo_service'
import { createListValidator } from '#validators/todo'

/**
 * The Lists screen and everything that changes a list.
 *
 * The mockup's Products grid becomes this (plan §13.6.2): same card shape,
 * with the stock pill re-cut as a todo count.
 */
export default class ListController {
  async index({ view, organization, request, bouncer }: HttpContext) {
    await bouncer.with('TodoListPolicy').authorize('viewAny', organization)

    const includeArchived = request.input('archived') === '1'

    return view.render('pages/lists/index', {
      lists: await lists.forOrganization(organization, { includeArchived }),
      includeArchived,
    })
  }

  async show({ params, view, organization, request, response, session, bouncer }: HttpContext) {
    const list = await lists.find(organization, params.id)

    if (!list) {
      session.flash('error', 'That list no longer exists.')
      return response.redirect().toRoute('lists.index')
    }

    await bouncer.with('TodoListPolicy').authorize('view', list)

    const filter = ['open', 'done'].includes(request.input('filter'))
      ? (request.input('filter') as 'open' | 'done')
      : 'all'

    const { default: memberships } = await import('#organizations/membership_service')

    return view.render('pages/lists/show', {
      list,
      todos: await todos.forList(list, filter),
      members: await memberships.members(organization),
      filter,
    })
  }

  async store({ request, response, session, auth, organization, bouncer }: HttpContext) {
    await bouncer.with('TodoListPolicy').authorize('create', organization)

    const payload = await request.validateUsing(createListValidator)

    try {
      const list = await lists.create(organization, auth.use('web').user!, {
        name: payload.name,
        description: payload.description ?? null,
        color: payload.color,
      })

      session.flash('success', `"${list.name}" is ready.`)
      return response.redirect().toRoute('lists.show', { id: list.publicId })
    } catch (error) {
      if (error instanceof ListError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('lists.index')
      }
      throw error
    }
  }

  async update({ params, request, response, session, organization, bouncer }: HttpContext) {
    const list = await lists.find(organization, params.id)

    if (!list) {
      session.flash('error', 'That list no longer exists.')
      return response.redirect().toRoute('lists.index')
    }

    await bouncer.with('TodoListPolicy').authorize('update', list)

    const payload = await request.validateUsing(createListValidator)

    try {
      await lists.rename(organization, list, {
        name: payload.name,
        description: payload.description ?? null,
        color: payload.color,
      })
      session.flash('success', 'List updated.')
    } catch (error) {
      if (error instanceof ListError) {
        session.flash('error', error.message)
      } else {
        throw error
      }
    }

    return response.redirect().toRoute('lists.show', { id: list.publicId })
  }

  /**
   * Archiving is reversible and open to any member. The list keeps its seat
   * against the `lists` quota, so this cannot be used to dodge the cap
   * (plan §5.6).
   */
  async archive({ params, response, session, organization, bouncer }: HttpContext) {
    const list = await lists.find(organization, params.id)

    if (!list) {
      session.flash('error', 'That list no longer exists.')
      return response.redirect().toRoute('lists.index')
    }

    await bouncer.with('TodoListPolicy').authorize('archive', list)

    if (list.isArchived) {
      await lists.unarchive(list)
      session.flash('success', `"${list.name}" is back.`)
    } else {
      await lists.archive(list)
      session.flash('success', `"${list.name}" archived. Nothing was deleted.`)
    }

    return response.redirect().toRoute('lists.index')
  }

  /**
   * Owner-only: it takes every todo inside with it (plan §6).
   */
  async destroy({ params, response, session, organization, bouncer }: HttpContext) {
    const list = await lists.find(organization, params.id)

    if (!list) {
      session.flash('error', 'That list no longer exists.')
      return response.redirect().toRoute('lists.index')
    }

    await bouncer.with('TodoListPolicy').authorize('delete', list)
    await lists.delete(list)

    session.flash('success', `"${list.name}" and its todos were deleted.`)
    return response.redirect().toRoute('lists.index')
  }
}
