import { test } from '@japa/runner'

import { CreemProvider } from '#billing/providers/creem'
import { WebhookVerificationError } from '#billing/contracts'
import { CREEM_TEST_SECRET, signedWebhook } from '#tests/helpers'

const provider = new CreemProvider({
  apiKey: 'test-api-key',
  apiUrl: 'https://test-api.creem.io',
  webhookSecret: CREEM_TEST_SECRET,
})

const parse = (body: Record<string, any>) =>
  provider.parseWebhook(Buffer.from(JSON.stringify(body)))

/**
 * A subscription object shaped the way Creem sends one.
 */
const subscriptionObject = (overrides: Record<string, any> = {}) => ({
  id: 'sub_1',
  status: 'active',
  customer: { id: 'cus_1' },
  product: { id: 'prod_test_pro' },
  current_period_start_date: '2026-09-01T00:00:00.000Z',
  current_period_end_date: '2026-10-01T00:00:00.000Z',
  cancel_at_period_end: false,
  metadata: { organization_public_id: 'org_abcdefghjkmn' },
  ...overrides,
})

const event = (eventType: string, object: Record<string, any>, id = 'evt_1') => ({
  id,
  eventType,
  created_at: '2026-09-07T10:00:00.000Z',
  object,
})

/**
 * All thirteen Creem events onto our nine (plan §7.2, §15).
 *
 * This is a table rather than thirteen tests because the mapping *is* a
 * table: the value of the suite is that it is exhaustive, and a missing row
 * is exactly the bug it catches.
 */
test.group('CreemProvider — event mapping', () => {
  const cases: [string, string, Record<string, any>][] = [
    [
      'checkout.completed',
      'subscription.activated',
      { subscription: subscriptionObject(), order: null },
    ],
    ['subscription.active', 'subscription.activated', subscriptionObject()],
    [
      'subscription.paid',
      'payment.succeeded',
      subscriptionObject({
        order: {
          id: 'ord_1',
          amount: 2900,
          currency: 'usd',
          created_at: '2026-09-07T10:00:00.000Z',
        },
      }),
    ],
    ['subscription.trialing', 'subscription.trialing', subscriptionObject({ status: 'trialing' })],
    ['subscription.update', 'subscription.updated', subscriptionObject()],
    ['subscription.past_due', 'subscription.past_due', subscriptionObject({ status: 'past_due' })],
    ['subscription.unpaid', 'subscription.past_due', subscriptionObject({ status: 'unpaid' })],
    ['subscription.paused', 'subscription.paused', subscriptionObject({ status: 'paused' })],
    [
      'subscription.scheduled_cancel',
      'subscription.updated',
      subscriptionObject({ cancel_at_period_end: true }),
    ],
    ['subscription.canceled', 'subscription.canceled', subscriptionObject({ status: 'canceled' })],
    ['subscription.expired', 'subscription.canceled', subscriptionObject({ status: 'expired' })],
    [
      'refund.created',
      'payment.refunded',
      {
        id: 'ref_1',
        order: { id: 'ord_1' },
        refund_amount: 2900,
        currency: 'usd',
        created_at: '2026-09-07T10:00:00.000Z',
      },
    ],
    ['dispute.created', 'dispute.created', { id: 'dis_1', order: { id: 'ord_1' } }],
  ]

  for (const [creemType, expected, object] of cases) {
    test(`${creemType} normalises to ${expected}`, ({ assert }) => {
      const normalized = parse(event(creemType, object))

      assert.equal(normalized.type, expected)
      assert.equal(normalized.providerEventId, 'evt_1')
      assert.equal(normalized.occurredAt.toISO(), '2026-09-07T10:00:00.000Z')
    })
  }

  test('every Creem event we claim to handle is covered by this table', ({ assert }) => {
    assert.lengthOf(cases, 13, 'plan §7.2 lists thirteen Creem events')
  })

  /**
   * An event type we have no mapping for is a change at the provider that
   * somebody has to look at — never a silently dropped billing event.
   */
  test('an unmapped event type is refused rather than ignored', ({ assert }) => {
    assert.throws(
      () => parse(event('subscription.something_new', subscriptionObject())),
      /Unmapped/
    )
  })

  test('a body that is not JSON is refused', ({ assert }) => {
    assert.throws(() => provider.parseWebhook(Buffer.from('not json')), WebhookVerificationError)
  })

  test('an event without an id is refused, because the id is the idempotency key', ({ assert }) => {
    assert.throws(
      () => parse({ eventType: 'subscription.active', object: subscriptionObject() } as any),
      /without an event id/
    )
  })
})

test.group('CreemProvider — normalised fields', () => {
  test('a subscription carries the fields the mirror stores', ({ assert }) => {
    const normalized = parse(event('subscription.active', subscriptionObject()))

    assert.equal(normalized.subscription?.id, 'sub_1')
    assert.equal(normalized.subscription?.customerId, 'cus_1')
    assert.equal(normalized.subscription?.productId, 'prod_test_pro')
    assert.equal(normalized.subscription?.status, 'active')
    assert.equal(normalized.subscription?.currentPeriodEnd?.toISO(), '2026-10-01T00:00:00.000Z')
    assert.isFalse(normalized.subscription?.cancelAtPeriodEnd)
  })

  /**
   * The thread that ties a checkout to a tenant (plan §7.5). Without it a
   * subscription cannot be attributed to anyone.
   */
  test('the organisation travels in the checkout metadata', ({ assert }) => {
    const normalized = parse(
      event('checkout.completed', {
        subscription: subscriptionObject(),
        order: {
          id: 'ord_1',
          amount: 2900,
          currency: 'usd',
          created_at: '2026-09-07T10:00:00.000Z',
        },
        metadata: { organization_public_id: 'org_abcdefghjkmn' },
      })
    )

    assert.equal(normalized.organizationPublicId, 'org_abcdefghjkmn')
  })

  test('checkout.completed carries the payment that rode along with it', ({ assert }) => {
    const normalized = parse(
      event('checkout.completed', {
        subscription: subscriptionObject(),
        order: {
          id: 'ord_1',
          amount: 2900,
          currency: 'usd',
          created_at: '2026-09-07T10:00:00.000Z',
        },
      })
    )

    assert.equal(normalized.payment?.orderId, 'ord_1')
    assert.equal(normalized.payment?.amountCents, 2900)
    assert.equal(normalized.payment?.currency, 'USD')
  })

  /**
   * Only the events that move money produce a payment. A `subscription.update`
   * carrying a stale order object must not write a second charge.
   */
  test('an event that moves no money produces no payment', ({ assert }) => {
    const normalized = parse(
      event('subscription.update', subscriptionObject({ order: { id: 'ord_1', amount: 2900 } }))
    )

    assert.isUndefined(normalized.payment)
  })

  test('a refund reports the refunded amount against the original order', ({ assert }) => {
    const normalized = parse(
      event('refund.created', {
        id: 'ref_1',
        order: { id: 'ord_1' },
        refund_amount: 1000,
        currency: 'usd',
        created_at: '2026-09-07T10:00:00.000Z',
      })
    )

    assert.equal(normalized.payment?.orderId, 'ord_1')
    assert.equal(normalized.payment?.refundedAmountCents, 1000)
  })

  test('creem statuses map onto ours', ({ assert }) => {
    const statuses: [string, string][] = [
      ['incomplete', 'past_due'],
      ['trialing', 'trialing'],
      ['active', 'active'],
      ['past_due', 'past_due'],
      ['unpaid', 'past_due'],
      ['paused', 'paused'],
      ['canceled', 'canceled'],
      ['expired', 'expired'],
    ]

    for (const [theirs, ours] of statuses) {
      const normalized = parse(event('subscription.update', subscriptionObject({ status: theirs })))
      assert.equal(normalized.subscription?.status, ours, `${theirs} → ${ours}`)
    }
  })

  /**
   * Creem sends a nested object on some endpoints and a bare id string on
   * others for the same field.
   */
  test('a reference reads the same whether it arrives nested or as a bare id', ({ assert }) => {
    const nested = parse(event('subscription.active', subscriptionObject()))
    const bare = parse(
      event(
        'subscription.active',
        subscriptionObject({ customer: 'cus_1', product: 'prod_test_pro' })
      )
    )

    assert.equal(nested.subscription?.customerId, bare.subscription?.customerId)
    assert.equal(nested.subscription?.productId, bare.subscription?.productId)
  })

  test('epoch-second timestamps parse to the same instant as ISO ones', ({ assert }) => {
    const normalized = parse(
      event('subscription.active', subscriptionObject({ current_period_end_date: 1790812800 }))
    )

    assert.equal(normalized.subscription?.currentPeriodEnd?.toISO(), '2026-10-01T00:00:00.000Z')
  })
})

/**
 * Signature verification (plan §7.5, step 1). An unsigned body is an attacker
 * telling us somebody upgraded.
 */
test.group('CreemProvider — signature verification', () => {
  test('accepts a body signed with the shared secret', ({ assert }) => {
    const { raw, headers } = signedWebhook(event('subscription.active', subscriptionObject()))

    assert.isTrue(provider.verifyWebhook(Buffer.from(raw), headers))
  })

  test('rejects a tampered body', ({ assert }) => {
    const { raw, headers } = signedWebhook(event('subscription.active', subscriptionObject()))
    const tampered = raw.replace('prod_test_pro', 'prod_test_business')

    assert.isFalse(provider.verifyWebhook(Buffer.from(tampered), headers))
  })

  test('rejects a missing signature', ({ assert }) => {
    const { raw } = signedWebhook(event('subscription.active', subscriptionObject()))

    assert.isFalse(provider.verifyWebhook(Buffer.from(raw), {}))
  })

  /**
   * `timingSafeEqual` throws on a length mismatch rather than returning
   * false, so a short signature must be rejected before it reaches there.
   */
  test('rejects a signature of the wrong length without throwing', ({ assert }) => {
    const { raw } = signedWebhook(event('subscription.active', subscriptionObject()))

    assert.isFalse(provider.verifyWebhook(Buffer.from(raw), { 'creem-signature': 'short' }))
  })

  test('rejects everything when no secret is configured', ({ assert }) => {
    const unconfigured = new CreemProvider({ apiKey: '', apiUrl: '', webhookSecret: '' })
    const { raw, headers } = signedWebhook(event('subscription.active', subscriptionObject()))

    assert.isFalse(unconfigured.verifyWebhook(Buffer.from(raw), headers))
  })
})
