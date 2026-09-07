import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import invitations from '#organizations/invitation_service'
import PlanLimitExceededException from '#exceptions/plan_limit_exceeded_exception'
import { seatUsage } from '#organizations/seats'
import { limitFor, planFor, plans } from '#config/plans'
import { addMember, createWorkspace } from '#tests/helpers'

test.group('Plan limits', () => {
  test('reads the limit from the plan', ({ assert }) => {
    const organization = { planKey: 'free', limitOverrides: null }
    assert.equal(limitFor(organization, 'seats'), 2)
    assert.equal(limitFor({ ...organization, planKey: 'pro' }, 'seats'), 10)
  })

  /**
   * `null` means unlimited; `0` means the feature is not on this plan at all.
   * Collapsing the two would either hide a screen that should be shown or
   * show one that has nothing behind it.
   */
  test('tells unlimited apart from unavailable', ({ assert }) => {
    assert.isNull(limitFor({ planKey: 'business', limitOverrides: null }, 'lists'))
    assert.equal(limitFor({ planKey: 'free', limitOverrides: null }, 'apiKeys'), 0)
  })

  test('a staff override wins over the plan', ({ assert }) => {
    assert.equal(limitFor({ planKey: 'free', limitOverrides: { seats: 25 } }, 'seats'), 25)
  })

  test('an override can grant unlimited', ({ assert }) => {
    assert.isNull(limitFor({ planKey: 'free', limitOverrides: { seats: null } }, 'seats'))
  })

  test('an override for one limit leaves the others alone', ({ assert }) => {
    const organization = { planKey: 'free', limitOverrides: { seats: 25 } }
    assert.equal(limitFor(organization, 'lists'), 3)
  })

  /**
   * A plan key removed from config must not lock a customer out of data they
   * already have.
   */
  test('an unknown plan falls back to free', ({ assert }) => {
    assert.equal(planFor('enterprise-that-never-shipped').name, 'Free')
  })

  test('every plan defines every limit', ({ assert }) => {
    const keys = Object.keys(plans.free.limits)

    for (const [name, plan] of Object.entries(plans)) {
      assert.deepEqual(Object.keys(plan.limits), keys, `${name} defines every limit`)
    }
  })
})

test.group('Seats', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('counts the owner', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const usage = await seatUsage(organization)

    assert.equal(usage.members, 1)
    assert.equal(usage.used, 1)
    assert.equal(usage.limit, 2)
    assert.equal(usage.remaining, 1)
    assert.isFalse(usage.isFull)
  })

  /**
   * A pending invitation holds a seat. Counting only members would let ten
   * invitations to a two-seat plan all succeed, and only bite once people
   * started accepting — after the customer had already promised them access.
   */
  test('counts pending invitations as well as members', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    await invitations.invite({ organization, invitedBy: user, email: 'a@example.com' })

    const usage = await seatUsage(organization)
    assert.equal(usage.used, 2)
    assert.isTrue(usage.isFull)
  })

  /**
   * Since M4 the owner hitting the seat cap gets the plan-limit exception,
   * not an `InvitationError` — they are the customer who can raise the
   * ceiling, so they get the numbers and the upsell (plan §7.4).
   */
  test('refuses the invitation that would exceed the limit', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    await invitations.invite({ organization, invitedBy: user, email: 'a@example.com' })

    await assert.rejects(
      () => invitations.invite({ organization, invitedBy: user, email: 'b@example.com' }),
      PlanLimitExceededException
    )
  })

  test('the refusal carries the usage the upsell renders', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    await invitations.invite({ organization, invitedBy: user, email: 'a@example.com' })

    try {
      await invitations.invite({ organization, invitedBy: user, email: 'b@example.com' })
      assert.fail('the second invitation should have been refused')
    } catch (error) {
      assert.instanceOf(error, PlanLimitExceededException)
      assert.equal((error as PlanLimitExceededException).details.limit, 'seats')
      assert.equal((error as PlanLimitExceededException).details.allowed, 2)
      assert.equal((error as PlanLimitExceededException).details.current, 2)
    }
  })

  /**
   * The race §5.5 exists to close: two invitations issued at once against the
   * last seat. Exactly one must win.
   */
  test('two simultaneous invitations cannot both take the last seat', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const results = await Promise.allSettled([
      invitations.invite({ organization, invitedBy: user, email: 'a@example.com' }),
      invitations.invite({ organization, invitedBy: user, email: 'b@example.com' }),
    ])

    const succeeded = results.filter((result) => result.status === 'fulfilled')
    assert.lengthOf(succeeded, 1, 'exactly one invitation claimed the last seat')

    const usage = await seatUsage(organization)
    assert.equal(usage.used, 2, 'and the cap was never exceeded')
  })

  test('accepting converts a held seat rather than claiming a new one', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    const before = await seatUsage(organization)
    await addMember(organization, user, 'a@example.com')
    const after = await seatUsage(organization)

    assert.equal(before.used, 1)
    assert.equal(after.used, 2, 'the pending seat became a member seat')
    assert.equal(after.members, 2)
    assert.equal(after.pendingInvitations, 0)
  })

  test('an override raises the ceiling', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    organization.limitOverrides = { seats: 4 }
    await organization.save()

    await addMember(organization, user, 'a@example.com')
    await addMember(organization, user, 'b@example.com')

    const usage = await seatUsage(organization)
    assert.equal(usage.used, 3)
    assert.equal(usage.limit, 4)
    assert.isFalse(usage.isFull)
  })

  test('an unlimited plan is never full', async ({ assert }) => {
    const { organization } = await createWorkspace()
    organization.limitOverrides = { seats: null }
    await organization.save()

    const usage = await seatUsage(organization)
    assert.isNull(usage.limit)
    assert.isNull(usage.remaining)
    assert.isFalse(usage.isFull)
  })

  test('an expired invitation stops holding its seat', async ({ assert }) => {
    const { user, organization } = await createWorkspace()
    const { invitation } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'a@example.com',
    })

    const beforeExpiry = await seatUsage(organization)
    assert.isTrue(beforeExpiry.isFull)

    const { DateTime } = await import('luxon')
    invitation.expiresAt = DateTime.utc().minus({ days: 1 })
    await invitation.save()

    const usage = await seatUsage(organization)
    assert.equal(usage.pendingInvitations, 0)
    assert.isFalse(usage.isFull)
  })
})
