import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import ApiRequest from '#models/api_request'
import ApiUsageDay from '#models/api_usage_day'
import usage from '#api/usage_service'
import rollupApiUsageJob, { RAW_RETENTION_DAYS } from '#queue/jobs/rollup_api_usage_job'
import { BURST_REQUESTS } from '#middleware/api_rate_limit'
import { clearRateLimits, createApiWorkspace, createWorkspace, runQueue } from '#tests/helpers'
import { DateTime } from 'luxon'

/**
 * Rate limiting (plan §11).
 *
 * Two rules with different jobs: the burst protects the service, the monthly
 * quota enforces what the plan sold. They get separate headers because one
 * header that sometimes means "this minute" and sometimes "this month" is
 * worse than two that each mean one thing.
 */
test.group('API rate limiting', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => clearRateLimits())

  test('every response carries the burst budget, not just a 429', async ({ client, assert }) => {
    const { headers } = await createApiWorkspace()

    const response = await client.get('/api/v1/lists').headers(headers)

    response.assertStatus(200)
    assert.equal(response.header('x-ratelimit-limit'), String(BURST_REQUESTS))
    assert.equal(response.header('x-ratelimit-remaining'), String(BURST_REQUESTS - 1))
    assert.isString(response.header('x-ratelimit-reset'))
  })

  test('the remaining budget goes down as it is spent', async ({ client, assert }) => {
    const { headers } = await createApiWorkspace()

    const first = await client.get('/api/v1/lists').headers(headers)
    const second = await client.get('/api/v1/lists').headers(headers)

    assert.equal(
      Number(second.header('x-ratelimit-remaining')),
      Number(first.header('x-ratelimit-remaining')) - 1
    )
  })

  /**
   * The plan's monthly allowance gets its own trio so a client can pace
   * against both windows.
   */
  test('the monthly quota is reported separately from the burst', async ({ client, assert }) => {
    const { headers } = await createApiWorkspace()

    const response = await client.get('/api/v1/lists').headers(headers)

    assert.equal(response.header('x-quota-limit'), '50000', 'Pro allows 50,000 a month')
    assert.equal(response.header('x-quota-remaining'), '49999')
  })

  test('an unlimited allowance spends no counter at all', async ({ client, assert }) => {
    const { organization, headers } = await createApiWorkspace()

    organization.limitOverrides = { apiCallsPerMonth: null }
    await organization.save()

    const response = await client.get('/api/v1/lists').headers(headers)

    response.assertStatus(200)
    assert.isUndefined(response.header('x-quota-limit'))
  })

  test('exceeding the monthly quota is a 429 with a retry hint', async ({ client, assert }) => {
    const { organization, headers } = await createApiWorkspace()

    organization.limitOverrides = { apiCallsPerMonth: 2 }
    await organization.save()

    await client.get('/api/v1/lists').headers(headers)
    await client.get('/api/v1/lists').headers(headers)

    const blocked = await client.get('/api/v1/lists').headers(headers)

    blocked.assertStatus(429)
    blocked.assertBodyContains({ error: { code: 'rate_limit_exceeded' } })
    assert.isString(blocked.header('retry-after'))
    assert.equal(blocked.header('x-ratelimit-remaining'), '0')
  })

  /**
   * The monthly allowance is a plan limit, so minting a second key must not
   * double it (plan §7.3).
   */
  test('a second key does not double the monthly allowance', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()

    organization.limitOverrides = { apiCallsPerMonth: 2, apiKeys: 5 }
    await organization.save()

    const { default: apiKeys } = await import('#api/api_key_service')
    const second = await apiKeys.create(organization, user, { name: 'another' })
    const secondHeaders = { authorization: `Bearer ${second.secret}` }

    await client.get('/api/v1/lists').headers(headers)
    await client.get('/api/v1/lists').headers(secondHeaders)

    const blocked = await client.get('/api/v1/lists').headers(secondHeaders)

    blocked.assertStatus(429)
    assert.isTrue(true)
  })

  /**
   * The burst rule is per key, so one runaway integration does not throttle
   * a customer's other ones.
   */
  test('the burst budget is per key', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace()

    organization.limitOverrides = { apiKeys: 5 }
    await organization.save()

    const { default: apiKeys } = await import('#api/api_key_service')
    const second = await apiKeys.create(organization, user, { name: 'another' })

    await client.get('/api/v1/lists').headers(headers)
    await client.get('/api/v1/lists').headers(headers)

    const fresh = await client
      .get('/api/v1/lists')
      .header('authorization', `Bearer ${second.secret}`)

    assert.equal(
      Number(fresh.header('x-ratelimit-remaining')),
      BURST_REQUESTS - 1,
      'the second key started with a full budget'
    )
  })
})

/**
 * Usage rollup and pruning (plan §5.2, §9).
 */
test.group('API usage rollup', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  const requestOn = async (organizationId: number, at: DateTime, status = 200) => {
    return ApiRequest.create({
      organizationId,
      apiKeyId: null,
      requestId: null,
      method: 'GET',
      path: '/api/v1/lists',
      status,
      durationMs: 3,
      ip: '127.0.0.1',
      createdAt: at,
    })
  }

  test('aggregates by organisation and day, counting errors separately', async ({ assert }) => {
    const { organization } = await createWorkspace()
    const day = DateTime.utc().minus({ days: 2 })

    await requestOn(organization.id, day)
    await requestOn(organization.id, day)
    await requestOn(organization.id, day, 500)
    await requestOn(organization.id, day.minus({ days: 1 }))

    await rollupApiUsageJob.handle()

    const rolled = await ApiUsageDay.query().orderBy('day', 'asc')

    assert.lengthOf(rolled, 2)
    assert.equal(rolled[1].requests, 3)
    assert.equal(rolled[1].errors, 1)
    assert.equal(rolled[0].requests, 1)
  })

  /**
   * At-least-once delivery means this runs twice sooner or later, and an
   * aggregate that incremented would double every figure (plan §9).
   */
  test('is idempotent — running it twice does not double the numbers', async ({ assert }) => {
    const { organization } = await createWorkspace()
    await requestOn(organization.id, DateTime.utc().minus({ days: 1 }))

    await rollupApiUsageJob.handle()
    await rollupApiUsageJob.handle()

    const rolled = await ApiUsageDay.query().firstOrFail()
    assert.equal(rolled.requests, 1)
  })

  test('keeps raw rows inside the retention window', async ({ assert }) => {
    const { organization } = await createWorkspace()
    await requestOn(organization.id, DateTime.utc().minus({ days: RAW_RETENTION_DAYS - 1 }))

    await rollupApiUsageJob.handle()

    assert.lengthOf(await ApiRequest.all(), 1)
  })

  test('prunes raw rows past it, but only once their day is rolled up', async ({ assert }) => {
    const { organization } = await createWorkspace()
    await requestOn(organization.id, DateTime.utc().minus({ days: RAW_RETENTION_DAYS + 1 }))

    await rollupApiUsageJob.handle()

    assert.isEmpty(await ApiRequest.all(), 'the raw row is gone')
    assert.lengthOf(await ApiUsageDay.all(), 1, 'but its numbers survive')
  })

  test('runs through the queue like every other job', async ({ assert }) => {
    const { organization } = await createWorkspace()
    await requestOn(organization.id, DateTime.utc().minus({ days: 1 }))

    const { default: queue } = await import('#queue/queue_service')
    await queue.dispatch(rollupApiUsageJob)

    assert.equal(await runQueue('default'), 1)
    assert.lengthOf(await ApiUsageDay.all(), 1)
  })

  test('one workspace never sees another’s usage', async ({ assert }) => {
    const a = await createWorkspace({ email: 'a@example.com' })
    const b = await createWorkspace({ email: 'b@example.com' })

    await requestOn(a.organization.id, DateTime.utc())
    await requestOn(b.organization.id, DateTime.utc())
    await requestOn(b.organization.id, DateTime.utc())

    assert.equal(await usage.monthToDate(a.organization), 1)
    assert.equal(await usage.monthToDate(b.organization), 2)
  })

  /**
   * Reading only the rollup would show today as zero until tomorrow, which
   * reliably reads as "the API is broken".
   */
  test('the usage view combines finished days with today’s raw rows', async ({ assert }) => {
    const { organization } = await createWorkspace()

    await requestOn(organization.id, DateTime.utc().minus({ days: 3 }))
    await rollupApiUsageJob.handle()

    await requestOn(organization.id, DateTime.utc())

    const days = await usage.recentDays(organization, 5)

    assert.lengthOf(days, 5, 'gaps are zero-filled, so a quiet weekend is not an outage')
    assert.equal(days[days.length - 1].requests, 1, 'today, from the raw rows')
    assert.equal(days[1].requests, 1, 'three days ago, from the rollup')
  })
})
