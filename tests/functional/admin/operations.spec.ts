import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import AuditLog from '#models/audit_log'
import Payment from '#models/payment'
import Subscription from '#models/subscription'
import WebhookEvent from '#models/webhook_event'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import metrics from '#admin/metrics_service'
import pruneAuditLogsJob, { AUDIT_RETENTION_DAYS } from '#queue/jobs/prune_audit_logs_job'
import {
  createStaff,
  createWorkspace,
  restorePaymentProvider,
  runQueue,
  signedWebhook,
  subscriptionWebhook,
  useFakePaymentProvider,
} from '#tests/helpers'

/**
 * The audit trail (plan §5.2, §12).
 */
test.group('Audit trail', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  /**
   * Never allowed to fail the action it describes: a support agent whose
   * "suspend this workspace" 500s because the audit insert broke will simply
   * do it again, and now there are two attempts and still no record.
   */
  test('a broken entry never fails the action it describes', async ({ assert }) => {
    await audit.recordSystemAction({
      action: AUDIT_ACTIONS.webhookReplayed,
      /**
       * Far longer than the column allows, so the insert fails.
       */
      subjectId: 'x'.repeat(5000),
      subjectType: 'y'.repeat(5000),
    })

    assert.isTrue(true, 'it returned rather than throwing')
  })

  test('records a system action with no actor', async ({ assert }) => {
    await audit.recordSystemAction({ action: AUDIT_ACTIONS.subscriptionSynced })

    const entry = await AuditLog.query().firstOrFail()
    assert.equal(entry.actorType, 'system')
    assert.isNull(entry.actorId)
  })

  test('filters combine, because the real questions are compound', async ({ assert }) => {
    const staff = await createStaff()
    const a = await createWorkspace({ email: 'a@example.com' })
    const b = await createWorkspace({ email: 'b@example.com' })

    const write = (organizationId: number, action: string) =>
      AuditLog.create({
        organizationId,
        actorType: 'staff',
        actorId: staff.id,
        action,
        createdAt: DateTime.utc(),
      })

    await write(a.organization.id, AUDIT_ACTIONS.planOverridden)
    await write(a.organization.id, AUDIT_ACTIONS.organizationSuspended)
    await write(b.organization.id, AUDIT_ACTIONS.planOverridden)

    assert.lengthOf(await audit.search({ organizationId: a.organization.id }), 2)
    assert.lengthOf(await audit.search({ action: AUDIT_ACTIONS.planOverridden }), 2)
    assert.lengthOf(
      await audit.search({
        organizationId: a.organization.id,
        action: AUDIT_ACTIONS.planOverridden,
      }),
      1
    )
    assert.lengthOf(await audit.search({ actorType: 'user' }), 0)
  })

  /**
   * The filter dropdown offers what is actually recorded, so it can only
   * ever contain filters that would return something.
   */
  test('offers only the actions that have happened', async ({ assert }) => {
    await audit.recordSystemAction({ action: AUDIT_ACTIONS.subscriptionSynced })

    assert.deepEqual(await audit.recordedActions(), ['subscription.synced'])
  })

  test('keeps entries inside the retention window and prunes past it', async ({ assert }) => {
    const fresh = await AuditLog.create({
      actorType: 'system',
      action: AUDIT_ACTIONS.subscriptionSynced,
      createdAt: DateTime.utc().minus({ days: AUDIT_RETENTION_DAYS - 1 }),
    })

    const stale = await AuditLog.create({
      actorType: 'system',
      action: AUDIT_ACTIONS.subscriptionSynced,
      createdAt: DateTime.utc().minus({ days: AUDIT_RETENTION_DAYS + 1 }),
    })

    await pruneAuditLogsJob.handle()

    assert.isNotNull(await AuditLog.find(fresh.id))
    assert.isNull(await AuditLog.find(stale.id))
  })

  test('the prune runs through the queue like every other job', async ({ assert }) => {
    const { default: queue } = await import('#queue/queue_service')
    await queue.dispatch(pruneAuditLogsJob)

    assert.equal(await runQueue('default'), 1)
  })
})

test.group('Back-office — the dashboard', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  const subscribe = async (organizationId: number, planKey: string, status: string) =>
    Subscription.create({
      organizationId,
      provider: 'creem',
      providerSubscriptionId: `sub_${planKey}_${status}_${Math.random().toString(36).slice(2, 8)}`,
      planKey,
      status: status as never,
      cancelAtPeriodEnd: false,
    })

  /**
   * MRR is the list price of every *entitling* subscription. `past_due`
   * counts — the customer is still on the plan and we are still trying to
   * collect, so excluding them would make a dunning problem look like churn.
   */
  test('MRR counts past_due, because we are still trying to collect', async ({ assert }) => {
    const a = await createWorkspace({ email: 'a@example.com' })
    const b = await createWorkspace({ email: 'b@example.com' })

    await subscribe(a.organization.id, 'pro', 'active')
    await subscribe(b.organization.id, 'pro', 'past_due')

    const figures = await metrics.collect()

    assert.equal(figures.mrrCents, 5800, 'two Pro subscriptions at $29')
    assert.equal(figures.activeSubscriptions, 1)
    assert.equal(figures.pastDueSubscriptions, 1)
  })

  test('a cancelled subscription stops counting toward MRR', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const subscription = await subscribe(organization.id, 'business', 'canceled')

    subscription.canceledAt = DateTime.utc().minus({ days: 3 })
    await subscription.save()

    const figures = await metrics.collect()

    assert.equal(figures.mrrCents, 0)
    assert.equal(figures.canceledLast30Days, 1)
  })

  /**
   * A shop with no customers has not retained them all.
   */
  test('churn is null rather than zero when there is nothing to divide by', async ({ assert }) => {
    const figures = await metrics.collect()

    assert.isNull(figures.churnRate)
  })

  /*
  | Growth (plan §12).
  |
  | The four counts are the ones somebody asks for out loud — who arrived, who
  | started paying, who paid again, who left — and the trap in all of them is
  | the boundary: a payment must be a *first* payment or a renewal and never
  | both, and a month must not borrow from the one beside it.
  */
  const pay = async (organizationId: number, occurredAt: DateTime, amountCents = 2900) =>
    Payment.create({
      organizationId,
      provider: 'creem',
      providerOrderId: `ord_${Math.random().toString(36).slice(2, 10)}`,
      amountCents,
      currency: 'USD',
      status: 'succeeded',
      refundedAmountCents: 0,
      occurredAt,
    })

  test('counts a first payment as new, and every one after it as a renewal', async ({ assert }) => {
    const { organization } = await createWorkspace({ email: 'a@example.com' })
    const now = DateTime.utc()

    await pay(organization.id, now.minus({ months: 1 }))
    await pay(organization.id, now)
    await pay(organization.id, now)

    const growth = await metrics.growth()

    assert.equal(growth.startedPaying.value, 0, 'they started paying last month, not this one')
    assert.equal(growth.startedPaying.previous, 1)
    assert.equal(growth.renewals.value, 2)
    assert.equal(growth.renewals.direction, 'up')
    assert.equal(growth.renewals.difference, 2)
  })

  test('a second workspace paying for the first time is new, not a renewal', async ({ assert }) => {
    const a = await createWorkspace({ email: 'a@example.com' })
    const b = await createWorkspace({ email: 'b@example.com' })
    const now = DateTime.utc()

    await pay(a.organization.id, now)
    await pay(b.organization.id, now)

    const growth = await metrics.growth()

    assert.equal(growth.startedPaying.value, 2)
    assert.equal(growth.renewals.value, 0)
  })

  test('counts cancellations in the month they happened', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const subscription = await subscribe(organization.id, 'pro', 'canceled')

    subscription.canceledAt = DateTime.utc().minus({ months: 1 })
    await subscription.save()

    const growth = await metrics.growth()

    assert.equal(growth.churned.value, 0)
    assert.equal(growth.churned.previous, 1)
    assert.equal(growth.churned.direction, 'down', 'fewer cancellations than last month')
  })

  /**
   * A month nobody signed up in is still a month. Twelve columns whatever
   * happened, or a quiet quarter reads as a busy one.
   */
  test('the window is twelve months, and the last of them is still running', async ({ assert }) => {
    await createWorkspace()

    const growth = await metrics.growth()

    assert.lengthOf(growth.months, 12)
    assert.isTrue(growth.months.at(-1)!.isCurrent)
    assert.isFalse(growth.months[0].isCurrent)
    assert.equal(growth.months.at(-1)!.registered, 1)
    assert.equal(growth.registeredInWindow, 1)
    assert.equal(growth.busiestMonth, 1)
  })

  /**
   * A bar for one signup in a window whose best month had thirty is a bar
   * nobody can see, so a month with anything in it never rounds to nothing.
   */
  test('a month with anything in it gets a visible bar', async ({ assert }) => {
    const now = DateTime.utc()
    const { organization } = await createWorkspace({ email: 'old@example.com' })

    organization.createdAt = now.minus({ months: 3 })
    await organization.save()

    for (let index = 0; index < 30; index++) {
      await createWorkspace({ email: `bulk-${index}@example.com` })
    }

    const growth = await metrics.growth()
    const quietMonth = growth.months.find((month) => month.registered === 1)!

    assert.isAtLeast(quietMonth.heightPercent, 2)
    assert.equal(growth.months.at(-1)!.heightPercent, 100, 'the busiest month sets the scale')
  })

  test('splits workspaces by the plan they are entitled to now', async ({ assert }) => {
    const free = await createWorkspace({ email: 'free@example.com' })
    const pro = await createWorkspace({ email: 'pro@example.com' })
    void free

    pro.organization.planKey = 'pro'
    await pro.organization.save()

    const growth = await metrics.growth()
    const mix = Object.fromEntries(growth.planMix.map((plan) => [plan.key, plan]))

    assert.equal(mix.free.count, 1)
    assert.equal(mix.pro.count, 1)
    assert.equal(mix.business.count, 0)
    assert.equal(mix.pro.percent, 50)
    assert.isFalse(mix.free.isPaid)
    assert.isTrue(mix.pro.isPaid)
    assert.equal(growth.payingWorkspaces, 1)
    assert.equal(growth.payingPercent, 50)
  })

  /*
  | Volume (plan §12).
  |
  | A refund does not delete the sale: the charge stays in gross and comes off
  | net. Getting that wrong is how a dashboard reports a month that never
  | happened.
  */
  test('gross keeps a refunded charge, net does not', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const now = DateTime.utc()

    await pay(organization.id, now.minus({ days: 2 }), 10000)
    const refunded = await pay(organization.id, now.minus({ days: 1 }), 4000)

    refunded.refundedAmountCents = 2500
    refunded.status = 'partially_refunded'
    await refunded.save()

    const revenue = await metrics.revenue('30d')

    assert.equal(revenue.gross.cents, 14000)
    assert.equal(revenue.refunded.cents, 2500)
    assert.equal(revenue.net.cents, 11500)
  })

  test('compares the window with the one before it', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const now = DateTime.utc()

    await pay(organization.id, now.minus({ days: 2 }), 4000)
    await pay(organization.id, now.minus({ days: 10 }), 2000)

    const revenue = await metrics.revenue('7d')

    assert.equal(revenue.gross.cents, 4000, 'only the last seven days')
    assert.equal(revenue.gross.previousCents, 2000, 'the seven days before those')
    assert.equal(revenue.gross.direction, 'up')
    assert.equal(revenue.gross.percent, 100)
  })

  /**
   * Nothing to divide by is not a 100% rise.
   */
  test('says so when there is nothing to compare against', async ({ assert }) => {
    const { organization } = await createWorkspace()

    await pay(organization.id, DateTime.utc().minus({ days: 1 }), 4000)

    const revenue = await metrics.revenue('7d')

    assert.isNull(revenue.gross.percent)
    assert.equal(revenue.gross.previousCents, 0)
  })

  /**
   * Minor units are only comparable inside one currency, so the headline is
   * the busiest one and the rest are listed rather than added to it.
   */
  test('reports one currency and names the others', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const now = DateTime.utc()

    await pay(organization.id, now.minus({ days: 1 }), 10000)
    const euros = await pay(organization.id, now.minus({ days: 1 }), 3000)

    euros.currency = 'EUR'
    await euros.save()

    const revenue = await metrics.revenue('30d')

    assert.equal(revenue.currency, 'USD')
    assert.equal(revenue.net.cents, 10000, 'the euros are not added in')
    assert.deepEqual(revenue.otherCurrencies, [{ currency: 'EUR', netCents: 3000 }])
  })

  test('attributes volume to the plan the subscription was on', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const subscription = await subscribe(organization.id, 'business', 'active')

    /* The workspace has since been moved to Pro; the charge was for Business. */
    organization.planKey = 'pro'
    await organization.save()

    const payment = await pay(organization.id, DateTime.utc().minus({ days: 1 }), 9900)
    payment.subscriptionId = subscription.id
    await payment.save()

    const revenue = await metrics.revenue('30d')

    assert.deepEqual(
      revenue.byPlan.map((plan) => [plan.key, plan.cents, Math.round(plan.percent)]),
      [['business', 9900, 100]]
    )
  })

  test('buckets by day up to a month, and by week beyond it', async ({ assert }) => {
    const { organization } = await createWorkspace()
    await pay(organization.id, DateTime.utc().minus({ days: 1 }), 4000)

    const week = await metrics.revenue('7d')
    assert.lengthOf(week.buckets, 7)
    assert.isFalse(week.bucketsAreWeekly)

    const quarter = await metrics.revenue('90d')
    assert.lengthOf(quarter.buckets, 13)
    assert.isTrue(quarter.bucketsAreWeekly)
    assert.equal(quarter.buckets.at(-1)!.heightPercent, 100)
  })

  test('surfaces what is broken: failed jobs and unapplied webhooks', async ({ assert }) => {
    await WebhookEvent.create({
      provider: 'creem',
      providerEventId: 'evt_stuck',
      eventType: 'subscription.activated',
      payload: {},
      signatureVerified: true,
      receivedAt: DateTime.utc(),
      attempts: 3,
    })

    const figures = await metrics.collect()

    assert.equal(figures.unprocessedWebhooks, 1)
  })

  test('revenue this month counts net of refunds', async ({ assert }) => {
    const { organization } = await createWorkspace()

    await Payment.create({
      organizationId: organization.id,
      provider: 'creem',
      providerOrderId: 'ord_1',
      amountCents: 2900,
      currency: 'USD',
      status: 'succeeded',
      refundedAmountCents: 900,
      occurredAt: DateTime.utc(),
    })

    const figures = await metrics.collect()

    assert.equal(figures.revenueThisMonthCents, 2000)
  })

  test('lists the workspaces that need somebody to look at them', async ({ assert }) => {
    const { organization } = await createWorkspace()

    organization.status = 'past_due'
    await organization.save()

    const attention = await metrics.needsAttention()

    assert.lengthOf(attention, 1)
    assert.equal(attention[0].id, organization.id)
  })

  test('renders', async ({ client }) => {
    const staff = await createStaff()

    const response = await client.get('/admin').withGuard('staff').loginAs(staff)

    response.assertStatus(200)
    response.assertTextIncludes('MRR')
  })
})

/**
 * The webhook ledger and its replay (plan §12) — the reason every payload is
 * stored.
 */
test.group('Back-office — the webhook ledger', (group) => {
  group.each.setup(() => {
    mail.fake()
    useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  const deliverButBreak = async (client: any, organizationPublicId?: string) => {
    const body = subscriptionWebhook({ organizationPublicId })
    const { headers } = signedWebhook(body)

    await client.post('/webhooks/creem').redirects(0).headers(headers).json(body)

    /**
     * Drain the queue: with no attributable organisation the job fails and
     * the ledger row stays unprocessed, which is exactly the state this
     * screen exists for.
     */
    await runQueue('default')

    return WebhookEvent.query().orderBy('id', 'desc').firstOrFail()
  }

  test('shows the events that never applied first', async ({ client }) => {
    const staff = await createStaff()
    await deliverButBreak(client)

    const response = await client.get('/admin/webhooks').withGuard('staff').loginAs(staff)

    response.assertStatus(200)
    response.assertTextIncludes('Never applied')
  })

  test('the detail screen shows the payload and why it failed', async ({ client }) => {
    const staff = await createStaff()
    const event = await deliverButBreak(client)

    const response = await client
      .get(`/admin/webhooks/${event.id}`)
      .withGuard('staff')
      .loginAs(staff)

    response.assertStatus(200)
    response.assertTextIncludes(event.providerEventId)
    response.assertTextIncludes('could not be attributed')
    response.assertTextIncludes('Not attributable')
  })

  /**
   * Replay is support-level because it is idempotent by construction: the
   * handler upserts on the provider's own ids.
   */
  test('support can replay one, and it applies', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })
    const { organization } = await createWorkspace()

    /**
     * Delivered before the workspace could be attributed, then replayed once
     * it can — which is the real-world sequence this screen exists for.
     */
    const event = await deliverButBreak(client)

    event.payload = {
      ...(event.payload as Record<string, any>),
      object: {
        ...(event.payload as Record<string, any>).object,
        metadata: { organization_public_id: organization.publicId },
      },
    }
    await event.save()

    const response = await client
      .post(`/admin/webhooks/${event.id}/replay`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await event.refresh()
    assert.isNotNull(event.processedAt)

    await organization.refresh()
    assert.equal(organization.planKey, 'pro')

    assert.lengthOf(await AuditLog.query().where('action', 'webhook.replayed'), 1)
  })

  test('a replay that still fails records why, and does not mark it done', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff()
    const event = await deliverButBreak(client)

    const response = await client
      .post(`/admin/webhooks/${event.id}/replay`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await event.refresh()
    assert.isNull(event.processedAt)
    assert.match(event.lastError ?? '', /could not be attributed/)
  })

  /**
   * At-least-once delivery means a replay happens twice sooner or later.
   */
  test('replaying twice changes nothing the second time', async ({ client, assert }) => {
    const staff = await createStaff()
    const { organization } = await createWorkspace()

    const event = await deliverButBreak(client, organization.publicId)

    const replay = () =>
      client
        .post(`/admin/webhooks/${event.id}/replay`)
        .withGuard('staff')
        .loginAs(staff)
        .withCsrfToken()
        .redirects(0)

    await replay()
    await replay()

    assert.lengthOf(await Subscription.all(), 1)
  })
})

/**
 * Subscriptions (plan §12): "ask the provider again" and "tell them to
 * stop", never "edit our copy".
 */
test.group('Back-office — subscriptions', (group) => {
  let provider: ReturnType<typeof useFakePaymentProvider>

  group.each.setup(() => {
    mail.fake()
    provider = useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  const local = async (organizationId: number) =>
    Subscription.create({
      organizationId,
      provider: 'creem',
      providerSubscriptionId: 'sub_1',
      providerCustomerId: 'cus_1',
      planKey: 'pro',
      status: 'active',
      cancelAtPeriodEnd: false,
    })

  test('syncing applies what the provider says, and the entitlement follows', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff({ role: 'support' })
    const { organization } = await createWorkspace()

    organization.planKey = 'pro'
    await organization.save()

    const subscription = await local(organization.id)

    provider.subscriptions.set('sub_1', {
      id: 'sub_1',
      customerId: 'cus_1',
      productId: 'prod_test_pro',
      status: 'canceled',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      canceledAt: DateTime.utc(),
    })

    const response = await client
      .post(`/admin/subscriptions/${subscription.id}/sync`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await subscription.refresh()
    await organization.refresh()

    assert.equal(subscription.status, 'canceled')
    assert.equal(organization.planKey, 'free', 'the entitlement followed')
    assert.lengthOf(await AuditLog.query().where('action', 'subscription.synced'), 1)
  })

  /**
   * Cancelling ends a paying relationship, so it is admin-only.
   */
  test('support cannot cancel', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })
    const { organization } = await createWorkspace()
    const subscription = await local(organization.id)

    const response = await client
      .post(`/admin/subscriptions/${subscription.id}/cancel`)
      .withGuard('staff')
      .loginAs(staff)
      .form({ reason: 'they asked' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isEmpty(provider.cancellations, 'nothing reached the provider')
  })

  test('an admin must give a reason', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const { organization } = await createWorkspace()
    const subscription = await local(organization.id)

    await client
      .post(`/admin/subscriptions/${subscription.id}/cancel`)
      .withGuard('staff')
      .loginAs(staff)
      .form({})
      .withCsrfToken()
      .redirects(0)

    assert.lengthOf(await AuditLog.query().where('action', 'subscription.canceled_by_staff'), 0)
  })

  /**
   * It cancels **at the provider** and lets the webhook change our copy —
   * our row agreeing without the provider would leave a customer billed for
   * a plan the admin panel says they cancelled.
   */
  test('an admin cancels at the provider, not in our copy', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const { organization } = await createWorkspace()
    const subscription = await local(organization.id)

    provider.subscriptions.set('sub_1', {
      id: 'sub_1',
      customerId: 'cus_1',
      productId: 'prod_test_pro',
      status: 'canceled',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: true,
      trialEndsAt: null,
      canceledAt: DateTime.utc(),
    })

    const response = await client
      .post(`/admin/subscriptions/${subscription.id}/cancel`)
      .withGuard('staff')
      .loginAs(staff)
      .form({ reason: 'duplicate account' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    assert.deepEqual(
      provider.cancellations,
      [{ subscriptionId: 'sub_1', atPeriodEnd: true }],
      'at the end of the paid period, which is the default'
    )

    await subscription.refresh()
    assert.equal(subscription.status, 'active', 'our copy waits for the webhook')

    const entry = await AuditLog.query()
      .where('action', 'subscription.canceled_by_staff')
      .firstOrFail()
    assert.equal(entry.metadata?.reason, 'duplicate account')
  })

  test('the reconciliation screen is the same dry run cron would do', async ({ client }) => {
    const staff = await createStaff()
    const { organization } = await createWorkspace()
    await local(organization.id)

    const response = await client
      .get('/admin/subscriptions/reconciliation')
      .withGuard('staff')
      .loginAs(staff)

    response.assertStatus(200)
    response.assertTextIncludes('Read-only')
    response.assertTextIncludes('never heard of')
  })
})
