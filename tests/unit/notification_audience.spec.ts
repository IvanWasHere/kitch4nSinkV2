import { test } from '@japa/runner'

import { appliesTo, describeAudience, type AudienceViewer } from '#notifications/audience'

/**
 * The audience predicate, exhaustively (plan §20.3, §20.7).
 *
 * This is the one place in the application that decides something without an
 * `organization_id` filter, because crossing tenants *is* the feature. A bug
 * here shows one customer another customer's announcement and nothing
 * downstream would catch it — so this file enumerates every combination
 * rather than spot-checking, the way `plan_service.spec.ts` does for limits.
 */
const PLANS = ['free', 'pro', 'business'] as const
const ROLES = ['owner', 'member'] as const

const viewer = (overrides: Partial<AudienceViewer> = {}): AudienceViewer => ({
  id: 1,
  role: 'member',
  planKey: 'free',
  ...overrides,
})

test.group('Audience — all', () => {
  test('reaches every role on every plan', ({ assert }) => {
    for (const planKey of PLANS) {
      for (const role of ROLES) {
        assert.isTrue(
          appliesTo({ audienceType: 'all', audience: null }, viewer({ role, planKey })),
          `${role} on ${planKey}`
        )
      }
    }
  })

  test('ignores an audience payload it does not need', ({ assert }) => {
    assert.isTrue(appliesTo({ audienceType: 'all', audience: { planKeys: ['pro'] } }, viewer()))
  })
})

test.group('Audience — plan', () => {
  test('reaches every role on a listed plan, and nobody on an unlisted one', ({ assert }) => {
    const notification = { audienceType: 'plan' as const, audience: { planKeys: ['pro'] } }

    for (const role of ROLES) {
      assert.isTrue(appliesTo(notification, viewer({ role, planKey: 'pro' })), `${role} on pro`)
      assert.isFalse(appliesTo(notification, viewer({ role, planKey: 'free' })), `${role} on free`)
      assert.isFalse(
        appliesTo(notification, viewer({ role, planKey: 'business' })),
        `${role} on business`
      )
    }
  })

  test('several plans at once', ({ assert }) => {
    const notification = {
      audienceType: 'plan' as const,
      audience: { planKeys: ['pro', 'business'] },
    }

    assert.isTrue(appliesTo(notification, viewer({ planKey: 'pro' })))
    assert.isTrue(appliesTo(notification, viewer({ planKey: 'business' })))
    assert.isFalse(appliesTo(notification, viewer({ planKey: 'free' })))
  })

  /**
   * Closed by default: an announcement that reaches nobody is a support
   * ticket, one that reaches everybody is an incident.
   */
  test('an empty plan list reaches nobody, not everybody', ({ assert }) => {
    for (const audience of [{ planKeys: [] }, {}, null]) {
      for (const planKey of PLANS) {
        assert.isFalse(
          appliesTo({ audienceType: 'plan', audience }, viewer({ planKey })),
          `${JSON.stringify(audience)} on ${planKey}`
        )
      }
    }
  })

  test('a plan key that no longer exists matches nobody', ({ assert }) => {
    assert.isFalse(
      appliesTo(
        { audienceType: 'plan', audience: { planKeys: ['enterprise-that-never-shipped'] } },
        viewer({ planKey: 'business' })
      )
    )
  })
})

test.group('Audience — owners', () => {
  test('reaches owners on every plan and no members at all', ({ assert }) => {
    const notification = { audienceType: 'owners' as const, audience: null }

    for (const planKey of PLANS) {
      assert.isTrue(appliesTo(notification, viewer({ role: 'owner', planKey })), `owner ${planKey}`)
      assert.isFalse(
        appliesTo(notification, viewer({ role: 'member', planKey })),
        `member ${planKey}`
      )
    }
  })

  /**
   * Unlike `plan`, an empty list here means "owners on any plan" — the type
   * has already narrowed the audience, so the list is a further filter rather
   * than the whole selection.
   */
  test('narrows by plan when asked, and does not when not', ({ assert }) => {
    const anyPlan = { audienceType: 'owners' as const, audience: { planKeys: [] } }
    const proOnly = { audienceType: 'owners' as const, audience: { planKeys: ['pro'] } }

    assert.isTrue(appliesTo(anyPlan, viewer({ role: 'owner', planKey: 'free' })))
    assert.isTrue(appliesTo(proOnly, viewer({ role: 'owner', planKey: 'pro' })))
    assert.isFalse(appliesTo(proOnly, viewer({ role: 'owner', planKey: 'free' })))

    /**
     * And still never a member, whatever the plan says.
     */
    assert.isFalse(appliesTo(proOnly, viewer({ role: 'member', planKey: 'pro' })))
  })
})

/**
 * The sharpest edge: a notification for one person must be invisible to
 * everybody else, including people in the same workspace.
 */
test.group('Audience — named users', () => {
  test('reaches exactly the ids listed', ({ assert }) => {
    const notification = { audienceType: 'users' as const, audience: { userIds: [7, 9] } }

    assert.isTrue(appliesTo(notification, viewer({ id: 7 })))
    assert.isTrue(appliesTo(notification, viewer({ id: 9 })))
    assert.isFalse(appliesTo(notification, viewer({ id: 8 })))
  })

  test('role and plan do not widen it', ({ assert }) => {
    const notification = { audienceType: 'users' as const, audience: { userIds: [7] } }

    for (const planKey of PLANS) {
      for (const role of ROLES) {
        assert.isFalse(
          appliesTo(notification, viewer({ id: 8, role, planKey })),
          `${role} on ${planKey} is still not user 7`
        )
      }
    }
  })

  test('an empty list reaches nobody', ({ assert }) => {
    for (const audience of [{ userIds: [] }, {}, null]) {
      assert.isFalse(appliesTo({ audienceType: 'users', audience }, viewer({ id: 7 })))
    }
  })

  /**
   * Ids are compared as numbers. A string that looks like one must not match,
   * or a hand-edited payload could widen an audience by accident.
   */
  test('does not match a string that looks like the id', ({ assert }) => {
    assert.isFalse(
      appliesTo(
        { audienceType: 'users', audience: { userIds: ['7' as unknown as number] } },
        viewer({ id: 7 })
      )
    )
  })
})

test.group('Audience — closed by default', () => {
  test('an unrecognised type reaches nobody', ({ assert }) => {
    assert.isFalse(
      appliesTo(
        { audienceType: 'everyone-forever' as never, audience: null },
        viewer({ role: 'owner', planKey: 'business' })
      )
    )
  })
})

test.group('Audience — how it reads in the back-office', () => {
  test('says who it reaches, not which enum was chosen', ({ assert }) => {
    assert.equal(describeAudience({ audienceType: 'all', audience: null }), 'Everyone')
    assert.equal(
      describeAudience({ audienceType: 'plan', audience: { planKeys: ['pro'] } }),
      'Everyone on pro'
    )
    assert.equal(
      describeAudience({ audienceType: 'owners', audience: null }),
      'All workspace owners'
    )
    assert.equal(
      describeAudience({ audienceType: 'owners', audience: { planKeys: ['business'] } }),
      'Owners on business'
    )
    assert.equal(
      describeAudience({ audienceType: 'users', audience: { userIds: [1] } }),
      '1 named person'
    )
  })

  /**
   * The one that matters: an author who picked a plan audience and no plans
   * should be told so before they publish, not afterwards.
   */
  test('says plainly when a choice would reach nobody', ({ assert }) => {
    assert.equal(
      describeAudience({ audienceType: 'plan', audience: { planKeys: [] } }),
      'Nobody — no plan chosen'
    )
  })
})
