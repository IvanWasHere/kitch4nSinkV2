import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import Todo from '#models/todo'
import TodoList from '#models/todo_list'
import lists from '#todos/list_service'
import todos from '#todos/todo_service'
import plans from '#billing/plan_service'
import PlanLimitExceededException from '#exceptions/plan_limit_exceeded_exception'
import { createList, createWorkspace } from '#tests/helpers'

/**
 * The quota suite (plan §15).
 *
 * Its own file because these are the rules customers pay for. Everything here
 * is about a boundary: the create at the cap, the concurrent creates at
 * cap-1, and the several ways a count could quietly be wrong.
 */
test.group('Quotas — lists', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a create at the cap is refused with the usage numbers', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    for (const name of ['One', 'Two', 'Three']) {
      await createList(organization, user, name)
    }

    try {
      await lists.create(organization, user, { name: 'Four' })
      assert.fail('the fourth list should have been refused')
    } catch (error) {
      assert.instanceOf(error, PlanLimitExceededException)

      const details = (error as PlanLimitExceededException).details
      assert.equal(details.limit, 'lists')
      assert.equal(details.allowed, 3)
      assert.equal(details.current, 3)
    }

    assert.equal(await plans.listCount(organization), 3, 'and nothing was inserted')
  })

  /**
   * The race §5.5 exists to close, and the reason `create` locks the
   * organisation row. Two creates against the last slot: exactly one wins.
   */
  test('two concurrent creates cannot both take the last slot', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    await createList(organization, user, 'One')
    await createList(organization, user, 'Two')

    const results = await Promise.allSettled([
      lists.create(organization, user, { name: 'Three' }),
      lists.create(organization, user, { name: 'Also three' }),
    ])

    const succeeded = results.filter((result) => result.status === 'fulfilled')

    assert.lengthOf(succeeded, 1, 'exactly one create claimed the last slot')
    assert.equal(await plans.listCount(organization), 3, 'and the cap was never exceeded')
  })

  /**
   * Archiving is a UI convenience, not a quota escape (plan §5.6).
   */
  test('archived lists still count against the cap', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const one = await createList(organization, user, 'One')
    await createList(organization, user, 'Two')
    await createList(organization, user, 'Three')

    await lists.archive(one)

    await assert.rejects(
      () => lists.create(organization, user, { name: 'Four' }),
      PlanLimitExceededException
    )
  })

  test('deleting a list frees a slot', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const one = await createList(organization, user, 'One')
    await createList(organization, user, 'Two')
    await createList(organization, user, 'Three')

    await lists.delete(one)

    const created = await lists.create(organization, user, { name: 'Four' })
    assert.equal(created.name, 'Four')
  })

  test('a staff override raises the ceiling without changing the plan', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    for (const name of ['One', 'Two', 'Three']) {
      await createList(organization, user, name)
    }

    organization.limitOverrides = { lists: 5 }
    await organization.save()

    await lists.create(organization, user, { name: 'Four' })

    assert.equal(organization.planKey, 'free', 'still on free')
    assert.equal(await plans.listCount(organization), 4)
  })

  test('an unlimited plan has no ceiling', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'business'
    await organization.save()

    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await createList(organization, user, name)
    }

    assert.equal(await plans.listCount(organization), 5)
  })
})

test.group('Quotas — todos per list', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  /**
   * Free allows 50 todos in a list, which is slow to reach honestly. The
   * override is the same mechanism staff use, so the cap under test is the
   * real one.
   */
  const cappedWorkspace = async (limit: number) => {
    const { user, organization } = await createWorkspace()

    organization.limitOverrides = { todosPerList: limit }
    await organization.save()

    return { user, organization }
  }

  test('a create at the cap is refused with the usage numbers', async ({ assert }) => {
    const { user, organization } = await cappedWorkspace(2)
    const list = await createList(organization, user, 'Capped', ['One', 'Two'])

    try {
      await todos.create(organization, list, user, { title: 'Three' })
      assert.fail('the third todo should have been refused')
    } catch (error) {
      assert.instanceOf(error, PlanLimitExceededException)

      const details = (error as PlanLimitExceededException).details
      assert.equal(details.limit, 'todosPerList')
      assert.equal(details.allowed, 2)
      assert.equal(details.current, 2)
    }

    await list.refresh()
    assert.equal(list.todosCount, 2, 'and the counter did not move')
  })

  test('two concurrent creates cannot both take the last slot', async ({ assert }) => {
    const { user, organization } = await cappedWorkspace(3)
    const list = await createList(organization, user, 'Capped', ['One', 'Two'])

    const results = await Promise.allSettled([
      todos.create(organization, list, user, { title: 'Three' }),
      todos.create(organization, list, user, { title: 'Also three' }),
    ])

    assert.lengthOf(
      results.filter((result) => result.status === 'fulfilled'),
      1,
      'exactly one create claimed the last slot'
    )

    await list.refresh()
    assert.equal(list.todosCount, 3, 'and the cap was never exceeded')
  })

  /**
   * The rule that reads as a bug unless the UI says it out loud (plan §5.5):
   * a fully ticked-off list at its cap is still full.
   */
  test('completed todos still count', async ({ assert }) => {
    const { user, organization } = await cappedWorkspace(2)
    const list = await createList(organization, user, 'Capped', ['One', 'Two'])

    for (const todo of await todos.forList(list)) {
      await todos.complete(todo, user)
    }

    await list.refresh()

    await assert.rejects(
      () => todos.create(organization, list, user, { title: 'Three' }),
      PlanLimitExceededException
    )
  })

  test('soft-deleted todos free a slot', async ({ assert }) => {
    const { user, organization } = await cappedWorkspace(2)
    const list = await createList(organization, user, 'Capped', ['One', 'Two'])

    const [first] = await todos.forList(list)
    await todos.delete(first)
    await list.refresh()

    const created = await todos.create(organization, list, user, { title: 'Three' })
    assert.equal(created.title, 'Three')
  })

  /**
   * The counter is the number the cap is checked against, so a drift between
   * it and reality is a quota bug rather than a cosmetic one.
   */
  test('todos_count matches COUNT(*) after a randomised create and delete run', async ({
    assert,
  }) => {
    const { user, organization } = await cappedWorkspace(100)
    const list = await createList(organization, user, 'Churn')

    const created: string[] = []

    for (let step = 0; step < 40; step++) {
      const shouldDelete = created.length > 0 && step % 3 === 0

      if (shouldDelete) {
        const publicId = created.shift()!
        const todo = await todos.find(organization, publicId)
        await todos.delete(todo!)
      } else {
        const todo = await todos.create(organization, list, user, { title: `Todo ${step}` })
        created.push(todo.publicId)
      }
    }

    await list.refresh()

    const [counted] = await Todo.query()
      .where('todo_list_id', list.id)
      .whereNull('deleted_at')
      .count('* as total')

    assert.equal(list.todosCount, Number(counted.$extras.total))
  })
})

/**
 * The soft-lock (plan §7.4, D9). A downgrade must never cost a customer
 * anything they already had — only the next *create* is blocked.
 */
test.group('Quotas — downgrade is a soft lock', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a downgrade leaves every row intact and editable', async ({ assert, client }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'pro'
    await organization.save()

    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await createList(organization, user, name)
    }

    const list = await createList(organization, user, 'Sixth', ['Still mine'])

    organization.planKey = 'free'
    await organization.save()

    /**
     * Nothing was archived, deleted or hidden by the downgrade — no data job
     * runs at all.
     */
    const surviving = await TodoList.query()
      .where('organization_id', organization.id)
      .whereNull('deleted_at')
    assert.lengthOf(surviving, 6)

    /**
     * And they are still *editable*, not just readable, which is what makes
     * re-upgrading need no restore job.
     */
    await lists.rename(organization, list, { name: 'Renamed after downgrade' })
    await list.refresh()
    assert.equal(list.name, 'Renamed after downgrade')

    const [todo] = await todos.forList(list)
    await todos.complete(todo, user)
    assert.isNotNull(todo.completedAt)

    /**
     * Only creating something new is refused, and only then.
     */
    await assert.rejects(
      () => lists.create(organization, user, { name: 'Seventh' }),
      PlanLimitExceededException
    )

    const response = await client
      .get('/lists')
      .withGuard('web')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(200)
    response.assertTextIncludes('Renamed after downgrade')
  })
})

/**
 * The web presentation of a block (plan §7.4). A refusal is a flash and the
 * inline upsell, never a 500 or a dead end.
 */
test.group('Quotas — how a block is presented', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a blocked create over HTML redirects back with the upsell numbers', async ({ client }) => {
    const { user, organization } = await createWorkspace()

    for (const name of ['One', 'Two', 'Three']) {
      await createList(organization, user, name)
    }

    const response = await client
      .post('/lists')
      .loginAs(user)
      .form({ name: 'Four' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertFlashMessage('error', 'Your plan allows 3 lists, and you are using 3.')

    /**
     * The same numbers the API returns, flashed so the page can render the
     * inline `.plan-card` upsell rather than only a toast.
     */
    response.assertFlashMessage('planLimit', {
      code: 'plan_limit_exceeded',
      message: 'Your plan allows 3 lists, and you are using 3.',
      limit: 'lists',
      allowed: 3,
      current: 3,
      upgradeUrl: '/billing',
    })
  })

  test('the Lists screen renders the upsell and disables the button at the cap', async ({
    client,
  }) => {
    const { user, organization } = await createWorkspace()

    for (const name of ['One', 'Two', 'Three']) {
      await createList(organization, user, name)
    }

    const response = await client.get('/lists').loginAs(user).withCsrfToken()

    response.assertStatus(200)
    response.assertTextIncludes('You are using all 3 lists on the Free plan')
    response.assertTextIncludes('disabled')
  })

  test('a blocked create over JSON is a 402 with a machine-readable limit', async ({ client }) => {
    const { user, organization } = await createWorkspace()

    for (const name of ['One', 'Two', 'Three']) {
      await createList(organization, user, name)
    }

    const response = await client
      .post('/lists')
      .json({ name: 'Four' })
      .accept('json')
      .withGuard('web')
      .loginAs(user)
      .withCsrfToken()

    response.assertStatus(402)
    response.assertBodyContains({
      error: {
        code: 'plan_limit_exceeded',
        limit: 'lists',
        allowed: 3,
        current: 3,
      },
    })
  })
})
