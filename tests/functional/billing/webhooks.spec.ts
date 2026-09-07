import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import Job from '#models/job'
import Payment from '#models/payment'
import Subscription from '#models/subscription'
import Organization from '#models/organization'
import WebhookEvent from '#models/webhook_event'
import {
  createWorkspace,
  queuedMailsTo,
  restorePaymentProvider,
  runQueue,
  signedWebhook,
  subscriptionWebhook,
  useFakePaymentProvider,
} from '#tests/helpers'

/**
 * The webhook endpoint and the handler behind it (plan §7.5, §15).
 *
 * The endpoint's contract is narrow on purpose — verify, record, dispatch,
 * 200 — so most of what matters here is what it *refuses* and what it does
 * exactly once.
 */
test.group('Webhooks — the endpoint', (group) => {
  group.each.setup(() => {
    mail.fake()
    useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  const post = (client: any, body: Record<string, any>) => {
    const { headers } = signedWebhook(body)

    return client.post('/webhooks/creem').redirects(0).headers(headers).json(body)
  }

  test('accepts a signed delivery, records it and queues the work', async ({ client, assert }) => {
    const { organization } = await createWorkspace()

    const response = await post(
      client,
      subscriptionWebhook({ organizationPublicId: organization.publicId })
    )

    response.assertStatus(200)

    const ledger = await WebhookEvent.query().firstOrFail()
    assert.equal(ledger.eventType, 'subscription.activated')
    assert.isTrue(ledger.signatureVerified)
    assert.isNull(ledger.processedAt, 'the endpoint records, the worker applies')

    const jobs = await Job.query().where('name', 'process_webhook')
    assert.lengthOf(jobs, 1)
  })

  /**
   * The whole reason for the unique index on `provider_event_id`: Creem
   * retries five times, and a retry must cost nothing.
   */
  test('a redelivery is a 200 and changes nothing', async ({ client, assert }) => {
    const { organization } = await createWorkspace()
    const body = subscriptionWebhook({ organizationPublicId: organization.publicId })

    await post(client, body)
    const second = await post(client, body)

    second.assertStatus(200)
    second.assertBodyContains({ duplicate: true })

    assert.lengthOf(await WebhookEvent.all(), 1)
    assert.lengthOf(await Job.query().where('name', 'process_webhook'), 1)
  })

  /**
   * An unsigned body is somebody claiming an upgrade happened.
   */
  test('refuses an unsigned body', async ({ client, assert }) => {
    const response = await client.post('/webhooks/creem').redirects(0).json(subscriptionWebhook({}))

    response.assertStatus(401)
    assert.lengthOf(await WebhookEvent.all(), 0)
  })

  test('refuses a body whose signature does not match it', async ({ client, assert }) => {
    const { body, headers } = signedWebhook(subscriptionWebhook({ subscriptionId: 'sub_a' }))

    /**
     * Signed as `sub_a`, delivered as `sub_b` — the exact shape of a replayed
     * webhook with the amount edited.
     */
    body.object.id = 'sub_b'

    const response = await client.post('/webhooks/creem').redirects(0).headers(headers).json(body)

    response.assertStatus(401)
    assert.lengthOf(await WebhookEvent.all(), 0)
  })

  /**
   * A signed event we have no mapping for is a change at Creem. 200, because
   * retrying will not make us understand it, and a log line instead.
   */
  test('a signed event we cannot parse is acknowledged but not recorded', async ({
    client,
    assert,
  }) => {
    const response = await post(client, {
      id: 'evt_new',
      eventType: 'subscription.something_creem_added',
      object: {},
    })

    response.assertStatus(200)
    response.assertBodyContains({ applied: false })
    assert.lengthOf(await WebhookEvent.all(), 0)
  })

  test('CSRF does not apply — there is no browser on the other end', async ({ client }) => {
    const { organization } = await createWorkspace()

    /**
     * No `withCsrfToken()` anywhere in this file. If shield were enforcing
     * here, every test above would already be a 403.
     */
    const response = await post(
      client,
      subscriptionWebhook({ organizationPublicId: organization.publicId })
    )

    response.assertStatus(200)
  })
})

test.group('Webhooks — applying an event', (group) => {
  group.each.setup(() => {
    mail.fake()
    useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  const deliver = async (client: any, body: Record<string, any>) => {
    const { headers } = signedWebhook(body)

    await client.post('/webhooks/creem').redirects(0).headers(headers).json(body)

    /**
     * Drain both queues: the webhook lands on `default`, and the emails it
     * produces land on `mail`.
     */
    await runQueue('default')

    return WebhookEvent.query().orderBy('id', 'desc').firstOrFail()
  }

  test('an activation moves the organisation onto the plan that was bought', async ({
    client,
    assert,
  }) => {
    const { organization } = await createWorkspace()

    const ledger = await deliver(
      client,
      subscriptionWebhook({ organizationPublicId: organization.publicId })
    )

    assert.isNotNull(ledger.processedAt)

    await organization.refresh()
    assert.equal(organization.planKey, 'pro')
    assert.equal(organization.status, 'active')

    const subscription = await Subscription.query().firstOrFail()
    assert.equal(subscription.organizationId, organization.id)
    assert.equal(subscription.planKey, 'pro')
    assert.equal(subscription.status, 'active')
    assert.equal(subscription.providerCustomerId, 'cus_test_1')
  })

  /**
   * Entitlements follow the provider, and the tenant is found through the
   * checkout metadata we put there ourselves (plan §7.5).
   */
  test('an event that cannot be attributed to a tenant is parked, not guessed at', async ({
    client,
    assert,
  }) => {
    await createWorkspace()

    const ledger = await deliver(client, subscriptionWebhook({}))

    assert.isNull(ledger.processedAt, 'never marked done')
    assert.match(ledger.lastError ?? '', /could not be attributed/)
  })

  test('a second delivery of the same subscription updates one row', async ({ client, assert }) => {
    const { organization } = await createWorkspace()

    await deliver(client, subscriptionWebhook({ organizationPublicId: organization.publicId }))
    await deliver(
      client,
      subscriptionWebhook({
        eventId: 'evt_2',
        eventType: 'subscription.past_due',
        status: 'past_due',
        organizationPublicId: organization.publicId,
      })
    )

    assert.lengthOf(await Subscription.all(), 1)

    const subscription = await Subscription.query().firstOrFail()
    assert.equal(subscription.status, 'past_due')

    await organization.refresh()
    assert.equal(organization.status, 'past_due')
    assert.equal(organization.planKey, 'pro', 'past_due keeps the plan — nothing is taken away')
  })

  /**
   * Webhooks arrive out of order. A late `past_due` must not undo the
   * `active` that superseded it (plan §7.5).
   */
  test('an event older than what the row already knows is ignored', async ({ client, assert }) => {
    const { organization } = await createWorkspace()

    await deliver(
      client,
      subscriptionWebhook({
        organizationPublicId: organization.publicId,
        createdAt: '2026-09-07T12:00:00.000Z',
      })
    )

    await deliver(
      client,
      subscriptionWebhook({
        eventId: 'evt_stale',
        eventType: 'subscription.past_due',
        status: 'past_due',
        organizationPublicId: organization.publicId,
        createdAt: '2020-01-01T00:00:00.000Z',
      })
    )

    const subscription = await Subscription.query().firstOrFail()
    assert.equal(subscription.status, 'active', 'the stale event did not win')

    await organization.refresh()
    assert.equal(organization.status, 'active')
  })

  /**
   * The downgrade path (plan §7.4): plan key to free, and nothing else. No
   * data job, no archiving.
   */
  test('a cancellation drops the plan to free and touches nothing else', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()

    await deliver(client, subscriptionWebhook({ organizationPublicId: organization.publicId }))

    const { default: lists } = await import('#todos/list_service')
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      await lists.create(organization, user, { name })
    }

    await deliver(
      client,
      subscriptionWebhook({
        eventId: 'evt_cancel',
        eventType: 'subscription.canceled',
        status: 'canceled',
        organizationPublicId: organization.publicId,
      })
    )

    await organization.refresh()
    assert.equal(organization.planKey, 'free')
    assert.equal(organization.status, 'active', 'a cancellation is not a suspension')

    const { default: plans } = await import('#billing/plan_service')
    assert.equal(await plans.listCount(organization), 4, 'every list survived the downgrade')
  })

  test('a payment is recorded once and emails one receipt', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    await deliver(client, subscriptionWebhook({ organizationPublicId: organization.publicId }))

    const paid = {
      id: 'evt_paid',
      eventType: 'subscription.paid',
      created_at: new Date().toISOString(),
      object: {
        id: 'sub_test_1',
        status: 'active',
        customer: { id: 'cus_test_1' },
        product: { id: 'prod_test_pro' },
        order: {
          id: 'ord_1',
          amount: 2900,
          currency: 'usd',
          created_at: new Date().toISOString(),
          description: 'Pro plan — monthly',
        },
      },
    }

    await deliver(client, paid)

    const payments = await Payment.all()
    assert.lengthOf(payments, 1)
    assert.equal(payments[0].amountCents, 2900)
    assert.equal(payments[0].currency, 'USD')
    assert.equal(payments[0].status, 'succeeded')
    assert.match(payments[0].publicId, /^pay_/)

    const queued = await queuedMailsTo(user.email)
    const receipts = queued.filter((message) => message.subject.includes('payment'))
    assert.lengthOf(receipts, 1, 'one charge, one receipt')
  })

  test('a refund grows the original row rather than writing a second one', async ({
    client,
    assert,
  }) => {
    const { organization } = await createWorkspace()

    await deliver(client, subscriptionWebhook({ organizationPublicId: organization.publicId }))

    const order = {
      id: 'ord_1',
      amount: 2900,
      currency: 'usd',
      created_at: new Date().toISOString(),
    }

    await deliver(client, {
      id: 'evt_paid',
      eventType: 'subscription.paid',
      created_at: new Date().toISOString(),
      object: { id: 'sub_test_1', customer: { id: 'cus_test_1' }, order },
    })

    await deliver(client, {
      id: 'evt_refund',
      eventType: 'refund.created',
      created_at: new Date().toISOString(),
      object: {
        id: 'ref_1',
        order: { id: 'ord_1' },
        subscription: 'sub_test_1',
        refund_amount: 1000,
        currency: 'usd',
        created_at: new Date().toISOString(),
      },
    })

    const payments = await Payment.all()
    assert.lengthOf(payments, 1, 'one order, one row')
    assert.equal(payments[0].amountCents, 2900)
    assert.equal(payments[0].refundedAmountCents, 1000)
    assert.equal(payments[0].status, 'partially_refunded')
    assert.equal(payments[0].netAmountCents, 1900)
  })

  test('a dispute marks the payment and changes nothing about access', async ({
    client,
    assert,
  }) => {
    const { organization } = await createWorkspace()

    await deliver(client, subscriptionWebhook({ organizationPublicId: organization.publicId }))

    await deliver(client, {
      id: 'evt_paid',
      eventType: 'subscription.paid',
      created_at: new Date().toISOString(),
      object: {
        id: 'sub_test_1',
        customer: { id: 'cus_test_1' },
        order: { id: 'ord_1', amount: 2900, currency: 'usd', created_at: new Date().toISOString() },
      },
    })

    await deliver(client, {
      id: 'evt_dispute',
      eventType: 'dispute.created',
      created_at: new Date().toISOString(),
      object: { id: 'dis_1', order: { id: 'ord_1' } },
    })

    const payment = await Payment.query().firstOrFail()
    assert.equal(payment.status, 'disputed')

    const fresh = await Organization.findOrFail(organization.id)
    assert.equal(fresh.status, 'active', 'suspending over a dispute is a human decision')
  })

  /**
   * The worker's own idempotency, independent of the endpoint's: a job that
   * runs twice must leave the same rows (plan §9).
   */
  test('applying the same stored event twice changes nothing', async ({ client, assert }) => {
    const { organization } = await createWorkspace()

    const ledger = await deliver(
      client,
      subscriptionWebhook({ organizationPublicId: organization.publicId })
    )

    const { default: webhooks } = await import('#billing/webhook_handler')
    const { paymentProvider } = await import('#billing/provider')

    await webhooks.apply(
      paymentProvider().parseWebhook(Buffer.from(JSON.stringify(ledger.payload)))
    )

    assert.lengthOf(await Subscription.all(), 1)

    await organization.refresh()
    assert.equal(organization.planKey, 'pro')
  })
})
