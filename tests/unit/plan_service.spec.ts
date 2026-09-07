import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import plans from '#billing/plan_service'
import { plans as catalogue, type LimitKey, type PlanKey } from '#config/plans'
import PlanLimitExceededException from '#exceptions/plan_limit_exceeded_exception'
import UpgradeRequiredException from '#exceptions/upgrade_required_exception'
import { createList, createWorkspace } from '#tests/helpers'

/**
 * Entitlement logic, exhaustively (plan §15).
 *
 * These are the rules customers pay for, so the suite walks every limit on
 * every plan rather than spot-checking one — a limit silently missing from a
 * plan is how somebody gets unlimited seats for $0.
 */
test.group('PlanService — entitlements', () => {
  const organizationOn = (
    planKey: string,
    limitOverrides: Record<string, number | null> | null = null
  ) => ({ planKey, limitOverrides }) as any

  test('every plan defines every limit', ({ assert }) => {
    const keys = Object.keys(catalogue.free.limits) as LimitKey[]

    for (const [name, plan] of Object.entries(catalogue)) {
      for (const key of keys) {
        assert.property(plan.limits, key, `${name} defines ${key}`)
      }
    }
  })

  test('every limit on every plan reads back', ({ assert }) => {
    const keys = Object.keys(catalogue.free.limits) as LimitKey[]

    for (const [planKey, plan] of Object.entries(catalogue)) {
      for (const key of keys) {
        assert.equal(
          plans.limit(organizationOn(planKey), key),
          plan.limits[key],
          `${planKey}.${key}`
        )
      }
    }
  })

  /**
   * `null` is unlimited; `0` means the plan does not have the feature at all,
   * so its screen is hidden rather than shown empty. Collapsing the two is the
   * bug this test exists to catch.
   */
  test('unlimited is not the same as unavailable', ({ assert }) => {
    assert.isNull(plans.limit(organizationOn('business'), 'lists'), 'business lists are unlimited')
    assert.equal(plans.limit(organizationOn('free'), 'apiKeys'), 0, 'free has no API keys')

    assert.isTrue(plans.isWithinLimit(organizationOn('business'), 'lists', 10_000))
    assert.isFalse(plans.isWithinLimit(organizationOn('free'), 'apiKeys', 1))
  })

  test('a limit is the count after the create, so the cap itself still fits', ({ assert }) => {
    const free = organizationOn('free')

    assert.isTrue(plans.isWithinLimit(free, 'lists', 3), 'the third list fits')
    assert.isFalse(plans.isWithinLimit(free, 'lists', 4), 'the fourth does not')
  })

  test('a staff override wins over the plan', ({ assert }) => {
    assert.equal(plans.limit(organizationOn('free', { lists: 25 }), 'lists'), 25)
    assert.isNull(
      plans.limit(organizationOn('free', { lists: null }), 'lists'),
      'null grants unlimited'
    )
    assert.equal(
      plans.limit(organizationOn('free', { lists: 25 }), 'seats'),
      2,
      'other limits are untouched'
    )
  })

  test('a plan that no longer exists falls back to free rather than locking anyone out', ({
    assert,
  }) => {
    assert.equal(plans.planFor(organizationOn('enterprise-that-never-shipped')).name, 'Free')
    assert.equal(plans.planKeyFor(organizationOn('enterprise-that-never-shipped')), 'free')
  })

  test('features gate per plan', ({ assert }) => {
    assert.isFalse(plans.can(organizationOn('free'), 'api'))
    assert.isTrue(plans.can(organizationOn('pro'), 'api'))
    assert.isFalse(plans.can(organizationOn('pro'), 'sso'))
    assert.isTrue(plans.can(organizationOn('business'), 'sso'))
  })

  test('assertCan throws a 402 for a feature the plan does not include', ({ assert }) => {
    assert.throws(
      () => plans.assertCan(organizationOn('free'), 'api'),
      'Your plan does not include api.'
    )

    try {
      plans.assertCan(organizationOn('free'), 'api')
    } catch (error) {
      assert.instanceOf(error, UpgradeRequiredException)
      assert.equal((error as UpgradeRequiredException).status, 402)
    }
  })

  test('assertWithinLimit carries the numbers the upsell renders', ({ assert }) => {
    try {
      plans.assertWithinLimit(organizationOn('free'), 'lists', 4)
      assert.fail('should have thrown')
    } catch (error) {
      assert.instanceOf(error, PlanLimitExceededException)

      const details = (error as PlanLimitExceededException).details
      assert.equal(details.limit, 'lists')
      assert.equal(details.allowed, 3)
      assert.equal(details.current, 3)
      assert.equal((error as PlanLimitExceededException).status, 402)
    }
  })

  /**
   * The reverse map a webhook depends on: without it, a `checkout.completed`
   * cannot say *which* plan was bought.
   */
  test('a provider product id maps back to a plan key', ({ assert }) => {
    assert.equal(plans.planKeyForProductId('prod_test_pro'), 'pro')
    assert.equal(plans.planKeyForProductId('prod_test_business'), 'business')
  })

  test('an unrecognised product id maps to nothing rather than guessing', ({ assert }) => {
    assert.isNull(plans.planKeyForProductId('prod_someone_elses'))
    assert.isNull(plans.planKeyForProductId(null))
    assert.isNull(plans.planKeyForProductId(''))
  })

  test('the plan grid is ordered by price', ({ assert }) => {
    const ordered = plans.purchasablePlans().map((entry) => entry.key)
    assert.deepEqual(ordered, ['free', 'pro', 'business'] as PlanKey[])
  })
})

test.group('PlanService — usage', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('counts lists and seats from the same source enforcement uses', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    await createList(organization, user, 'One')
    await createList(organization, user, 'Two')

    const usage = await plans.usage(organization)

    assert.equal(usage.lists.current, 2)
    assert.equal(usage.lists.limit, 3)
    assert.equal(usage.lists.remaining, 1)
    assert.isFalse(usage.lists.isFull)

    assert.equal(usage.seats.current, 1, 'the owner')
    assert.equal(usage.seats.limit, 2)
  })

  /**
   * Archiving hides a list; it does not free a slot (plan §5.6). If it did,
   * the `lists` cap would be trivially escapable.
   */
  test('archived lists still count', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'One')

    const { default: lists } = await import('#todos/list_service')
    await lists.archive(list)

    const usage = await plans.usage(organization)
    assert.equal(usage.lists.current, 1)
  })

  test('deleting a list frees a slot', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const list = await createList(organization, user, 'One')

    const { default: lists } = await import('#todos/list_service')
    await lists.delete(list)

    const usage = await plans.usage(organization)
    assert.equal(usage.lists.current, 0)
  })

  test('a meter turns amber at 80% and full at the cap', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    /**
     * Five so that 80% is a whole number of lists — the boundary is what is
     * under test, not the rounding.
     */
    organization.limitOverrides = { lists: 5 }
    await organization.save()

    for (const name of ['One', 'Two', 'Three']) {
      await createList(organization, user, name)
    }

    let usage = await plans.usage(organization)
    assert.isFalse(usage.lists.isNearLimit, '3 of 5 is 60%')

    await createList(organization, user, 'Four')

    usage = await plans.usage(organization)
    assert.isTrue(usage.lists.isNearLimit, '4 of 5 is exactly 80%')
    assert.isFalse(usage.lists.isFull)

    await createList(organization, user, 'Five')

    usage = await plans.usage(organization)
    assert.isTrue(usage.lists.isFull)
    assert.equal(usage.lists.remaining, 0)
  })

  /**
   * A downgrade can leave usage *above* the ceiling. That must read as full
   * rather than as negative headroom (plan §7.4, soft-lock).
   */
  test('usage above the ceiling reads as full, not as negative headroom', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'pro'
    await organization.save()

    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await createList(organization, user, name)
    }

    organization.planKey = 'free'
    await organization.save()

    const usage = await plans.usage(organization)
    assert.equal(usage.lists.current, 5)
    assert.equal(usage.lists.limit, 3)
    assert.equal(usage.lists.remaining, 0, 'clamped, never negative')
    assert.isTrue(usage.lists.isFull)
  })

  test('an unlimited plan never reads as full or near', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'business'
    await organization.save()

    await createList(organization, user, 'One')

    const usage = await plans.usage(organization)
    assert.isNull(usage.lists.limit)
    assert.isNull(usage.lists.remaining)
    assert.isFalse(usage.lists.isFull)
    assert.isFalse(usage.lists.isNearLimit)
  })
})
