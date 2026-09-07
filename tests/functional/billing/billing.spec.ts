import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import Payment from '#models/payment'
import Subscription from '#models/subscription'
import type Organization from '#models/organization'
import billing, { BillingError } from '#billing/billing_service'
import { PaymentProviderError } from '#billing/contracts'
import {
  addMember,
  createWorkspace,
  restorePaymentProvider,
  useFakePaymentProvider,
  type FakePaymentProvider,
} from '#tests/helpers'

/**
 * A live subscription for an organisation, written the way a webhook would
 * have written it.
 */
async function subscribe(organization: Organization, planKey: 'pro' | 'business' = 'pro') {
  organization.planKey = planKey
  await organization.save()

  return Subscription.create({
    organizationId: organization.id,
    provider: 'creem',
    providerSubscriptionId: 'sub_live_1',
    providerCustomerId: 'cus_live_1',
    planKey,
    status: 'active',
    currentPeriodStart: DateTime.utc().startOf('month'),
    currentPeriodEnd: DateTime.utc().startOf('month').plus({ months: 1 }),
    cancelAtPeriodEnd: false,
  })
}

test.group('Billing screen', (group) => {
  group.each.setup(() => {
    mail.fake()
    useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  /**
   * Billing is owner-only (plan §6) — a member does not see the screen at
   * all, rather than seeing it with every button refused.
   */
  test('a member cannot reach billing', async ({ client }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client.get('/billing').loginAs(member).redirects(0)

    response.assertStatus(302)
    response.assertFlashMessage('error', 'Only the workspace owner can do that.')
  })

  test('the owner sees the plan grid and their usage', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/billing').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('Current plan: Free')
    response.assertTextIncludes('Pro')
    response.assertTextIncludes('Business')
    response.assertTextIncludes('Usage on this plan')
    response.assertTextIncludes('No transactions yet')
  })

  test('transaction history renders what the provider confirmed', async ({ client }) => {
    const { user, organization } = await createWorkspace()
    const subscription = await subscribe(organization)

    await Payment.create({
      organizationId: organization.id,
      subscriptionId: subscription.id,
      provider: 'creem',
      providerOrderId: 'ord_1',
      amountCents: 2900,
      currency: 'USD',
      status: 'succeeded',
      refundedAmountCents: 0,
      description: 'Pro plan — monthly',
      occurredAt: DateTime.utc(),
    })

    const response = await client.get('/billing').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('Current plan: Pro')
    response.assertTextIncludes('Pro plan — monthly')
    response.assertTextIncludes('$29.00')
    response.assertTextIncludes('Paid')
  })
})

test.group('Billing — checkout', (group) => {
  let provider: FakePaymentProvider

  group.each.setup(() => {
    mail.fake()
    provider = useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  /**
   * The thread that ties the eventual webhook to this tenant (plan §7.5).
   * Everything else about a checkout can be reconstructed; this cannot.
   */
  test('sends the organisation to the provider with its public id in the metadata', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()

    const response = await client
      .post('/billing/checkout')
      .loginAs(user)
      .form({ plan: 'pro' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', 'https://checkout.test/prod_test_pro')

    assert.lengthOf(provider.checkouts, 1)
    assert.equal(provider.checkouts[0].productId, 'prod_test_pro')
    assert.equal(provider.checkouts[0].customerEmail, user.email)
    assert.equal(provider.checkouts[0].metadata.organizationPublicId, organization.publicId)
    assert.equal(provider.checkouts[0].metadata.planKey, 'pro')
  })

  /**
   * Nothing about entitlements moves until the webhook lands. A checkout
   * *started* is not a subscription.
   */
  test('starting a checkout changes no entitlement', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    await client
      .post('/billing/checkout')
      .loginAs(user)
      .form({ plan: 'pro' })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.equal(organization.planKey, 'free')
    assert.lengthOf(await Subscription.all(), 0)
  })

  test('refuses a plan that does not exist', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    const response = await client
      .post('/billing/checkout')
      .loginAs(user)
      .form({ plan: 'enterprise' })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'That plan does not exist.')
    assert.lengthOf(provider.checkouts, 0)
  })

  /**
   * Free is not something you buy — leaving a paid plan is a cancellation
   * through the provider's portal, so it decides when the paid period ends.
   */
  test('refuses to check out the free plan', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    await assert.rejects(
      () => billing.startCheckout(organization, user, 'free'),
      'The Free plan is not something you check out.'
    )
  })

  /**
   * A provider outage must read as "nothing was charged", not as a stack
   * trace to somebody holding their card.
   */
  test('a provider outage is a message, not a 500', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    provider.failWith = new PaymentProviderError('Creem is down', 503)

    const response = await client
      .post('/billing/checkout')
      .loginAs(user)
      .form({ plan: 'pro' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertFlashMessage(
      'error',
      'We could not reach our payment provider just now. Nothing was charged — please try again.'
    )

    assert.lengthOf(await Subscription.all(), 0)
  })
})

test.group('Billing — the return screen', (group) => {
  group.each.setup(() => {
    mail.fake()
    useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  /**
   * The return URL grants nothing — a user can type it by hand — so with no
   * webhook yet it must say "waiting", not "you are subscribed" (plan §7.5).
   */
  test('waits for the webhook rather than trusting the redirect', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    const response = await client.get('/billing/return').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('Activating your subscription')

    await organization.refresh()
    assert.equal(organization.planKey, 'free', 'reaching the return URL entitles nobody')
  })

  test('the poll endpoint reports what the webhook has actually applied', async ({ client }) => {
    const { user, organization } = await createWorkspace()

    let response = await client.get('/billing/status').loginAs(user).accept('json')
    response.assertBodyContains({ active: false, planKey: 'free' })

    await subscribe(organization)

    response = await client.get('/billing/status').loginAs(user).accept('json')
    response.assertBodyContains({ active: true, status: 'active', planKey: 'pro' })
  })
})

test.group('Billing — the provider portal', (group) => {
  let provider: FakePaymentProvider

  group.each.setup(() => {
    mail.fake()
    provider = useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  test('sends the owner to the provider rather than rebuilding card handling', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    await subscribe(organization)

    const response = await client.post('/billing/portal').loginAs(user).withCsrfToken().redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', 'https://portal.test/cus_live_1')

    assert.equal(provider.portals[0].customerId, 'cus_live_1')
  })

  test('says so plainly when there is nothing to manage', async ({ assert }) => {
    const { organization } = await createWorkspace()

    await assert.rejects(
      () => billing.startPortal(organization),
      'This workspace has no subscription to manage.'
    )
  })

  /**
   * A subscription recorded before the provider told us who the customer was
   * is recoverable by asking, rather than by showing the owner a dead button.
   */
  test('re-fetches a missing customer id instead of failing', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const subscription = await subscribe(organization)

    subscription.providerCustomerId = null
    await subscription.save()

    provider.subscriptions.set('sub_live_1', {
      id: 'sub_live_1',
      customerId: 'cus_recovered',
      productId: 'prod_test_pro',
      status: 'active',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      canceledAt: null,
    })

    const { url } = await billing.startPortal(organization)

    assert.equal(url, 'https://portal.test/cus_recovered')

    await subscription.refresh()
    assert.equal(subscription.providerCustomerId, 'cus_recovered', 'and remembered for next time')
  })

  test('gives up gracefully when the provider has no customer either', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const subscription = await subscribe(organization)

    subscription.providerCustomerId = null
    await subscription.save()

    try {
      await billing.startPortal(organization)
      assert.fail('should have refused')
    } catch (error) {
      assert.instanceOf(error, BillingError)
      assert.equal((error as BillingError).reason, 'no_customer')
    }
  })
})

/**
 * The account-state banner (plan §7.5, §13.5). A `past_due` workspace stays
 * fully usable — the banner is how the owner finds out before the period ends.
 */
test.group('Billing — the past_due banner', (group) => {
  group.each.setup(() => {
    mail.fake()
    useFakePaymentProvider()

    return () => {
      mail.restore()
      restorePaymentProvider()
    }
  })
  group.each.setup(() => testUtils.db().truncate())

  test('shows on every screen and says nothing was taken away', async ({ client }) => {
    const { user, organization } = await createWorkspace()

    organization.status = 'past_due'
    await organization.save()

    const response = await client.get('/dashboard').loginAs(user)

    response.assertStatus(200)
    response.assertTextIncludes('We could not take payment')
    response.assertTextIncludes('Nothing has been taken away')
  })

  test('a past_due workspace can still do its work', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    organization.status = 'past_due'
    await organization.save()

    const response = await client
      .post('/lists')
      .loginAs(user)
      .form({ name: 'Still working' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const { default: plans } = await import('#billing/plan_service')
    assert.equal(await plans.listCount(organization), 1)
  })
})
