import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import testUtils from '@adonisjs/core/services/test_utils'

import ApiKey from '#models/api_key'
import ApiRequest from '#models/api_request'
import apiKeys from '#api/api_key_service'
import { generateApiKey } from '#api/keys'
import { addMember, createApiWorkspace, createWorkspace } from '#tests/helpers'

/**
 * Authentication (plan §11, §15).
 *
 * The key *is* the scope, so this is the boundary the whole API rests on.
 */
test.group('API authentication', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a valid key authenticates its own organisation', async ({ client, assert }) => {
    const { organization, headers } = await createApiWorkspace()

    const response = await client.get('/api/v1/lists').headers(headers)

    response.assertStatus(200)
    assert.equal(response.body().data.length, 0)

    /**
     * Nothing in the request named the organisation.
     */
    response.assertBodyContains({ meta: { limit: 25 } })
    void organization
  })

  test('refuses a request with no key', async ({ client }) => {
    const response = await client.get('/api/v1/lists')

    response.assertStatus(401)
    response.assertBodyContains({ error: { code: 'unauthorized' } })
  })

  test('refuses a key we have never issued', async ({ client }) => {
    const response = await client
      .get('/api/v1/lists')
      .header('authorization', `Bearer ${generateApiKey().secret}`)

    response.assertStatus(401)
  })

  test('refuses a malformed authorization header', async ({ client }) => {
    for (const header of ['nonsense', 'Basic abc', 'Bearer', 'Bearer sk_live_short']) {
      const response = await client.get('/api/v1/lists').header('authorization', header)
      response.assertStatus(401)
    }
  })

  /**
   * Every failure answers identically, so somebody who found a key cannot
   * probe whether it is still live.
   */
  test('a revoked key is indistinguishable from an unknown one', async ({ client, assert }) => {
    const { apiKey, headers } = await createApiWorkspace()
    await apiKeys.revoke(apiKey)

    const revoked = await client.get('/api/v1/lists').headers(headers)
    const unknown = await client
      .get('/api/v1/lists')
      .header('authorization', `Bearer ${generateApiKey().secret}`)

    revoked.assertStatus(401)
    assert.deepEqual(revoked.body(), unknown.body())
  })

  test('an expired key is refused', async ({ client }) => {
    const { apiKey, headers } = await createApiWorkspace()

    apiKey.expiresAt = DateTime.utc().minus({ days: 1 })
    await apiKey.save()

    const response = await client.get('/api/v1/lists').headers(headers)

    response.assertStatus(401)
  })

  test('the plaintext key is never stored', async ({ assert }) => {
    const { secret } = await createApiWorkspace()

    const stored = await ApiKey.query().firstOrFail()

    assert.notEqual(stored.keyHash, secret)
    assert.notInclude(JSON.stringify(stored.toJSON()), secret.slice(8))
  })

  /**
   * A plan can change between minting a key and using it, so entitlement is
   * checked per request. A cancelled subscription closes the API without
   * anybody having to revoke anything.
   */
  test('a plan without the api feature is a 402, not a 401', async ({ client }) => {
    const { organization, headers } = await createApiWorkspace()

    organization.planKey = 'free'
    await organization.save()

    const response = await client.get('/api/v1/lists').headers(headers)

    response.assertStatus(402)
    response.assertBodyContains({
      error: { code: 'upgrade_required', details: { feature: 'api' } },
    })
  })

  test('a suspended workspace cannot call the API', async ({ client }) => {
    const { organization, headers } = await createApiWorkspace()

    organization.status = 'suspended'
    await organization.save()

    const response = await client.get('/api/v1/lists').headers(headers)

    response.assertStatus(401)
  })

  /**
   * `last_used_at` is what tells a customer which key is safe to revoke, but
   * a write per request would double the API's database traffic (plan §11).
   */
  test('last_used_at is stamped, then throttled to once a minute', async ({ client, assert }) => {
    const { apiKey, headers } = await createApiWorkspace()

    await client.get('/api/v1/lists').headers(headers)
    await apiKey.refresh()

    const first = apiKey.lastUsedAt
    assert.isNotNull(first)

    await client.get('/api/v1/lists').headers(headers)
    await apiKey.refresh()

    assert.equal(
      apiKey.lastUsedAt?.toMillis(),
      first?.toMillis(),
      'the second call within the minute did not write'
    )
  })
})

/**
 * Scopes (plan §11). A key is not a user: permissions are explicit, and the
 * owner/member split is mirrored through scopes rather than inherited.
 */
test.group('API scopes', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a read-only key can read', async ({ client }) => {
    const { headers } = await createApiWorkspace({ scopes: ['lists:read'] })

    const response = await client.get('/api/v1/lists').headers(headers)

    response.assertStatus(200)
  })

  test('a read-only key cannot create', async ({ client, assert }) => {
    const { headers, organization } = await createApiWorkspace({ scopes: ['lists:read'] })

    const response = await client.post('/api/v1/lists').headers(headers).json({ name: 'Nope' })

    response.assertStatus(403)
    response.assertBodyContains({
      error: { code: 'insufficient_scope', details: { required_scope: 'lists:write' } },
    })

    const { default: plans } = await import('#billing/plan_service')
    assert.equal(await plans.listCount(organization), 0)
  })

  /**
   * Deleting a list takes every todo inside it. The web app makes that
   * owner-only; the API refuses it on a read-only key (plan §11).
   */
  test('a read-only key cannot delete a list', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace({ scopes: ['lists:read'] })

    const { createList } = await import('#tests/helpers')
    const list = await createList(organization, user, 'Shared work')

    const response = await client.delete(`/api/v1/lists/${list.publicId}`).headers(headers)

    response.assertStatus(403)

    await list.refresh()
    assert.isNull(list.deletedAt)
  })

  test('the error names the scope that is missing, so the fix is obvious', async ({ client }) => {
    const { headers } = await createApiWorkspace({ scopes: ['lists:read'] })

    const response = await client
      .post('/api/v1/lists')
      .headers(headers)
      .json({ name: 'Needs a write scope' })

    response.assertTextIncludes('lists:write')
  })

  test('a key without members:read cannot read the directory', async ({ client }) => {
    const { headers } = await createApiWorkspace({ scopes: ['lists:read'] })

    const response = await client.get('/api/v1/members').headers(headers)

    response.assertStatus(403)
  })

  test('todos and lists scopes are independent', async ({ client, assert }) => {
    const { user, organization, headers } = await createApiWorkspace({
      scopes: ['lists:read', 'todos:write'],
    })

    const { createList } = await import('#tests/helpers')
    const list = await createList(organization, user, 'Work')

    const created = await client
      .post(`/api/v1/lists/${list.publicId}/todos`)
      .headers(headers)
      .json({ title: 'Write it' })

    created.assertStatus(201)

    /**
     * `todos:write` does not imply `todos:read`.
     */
    const read = await client.get(`/api/v1/lists/${list.publicId}/todos`).headers(headers)
    read.assertStatus(403)

    assert.isTrue(true)
  })
})

/**
 * Key management is owner-only (D4, plan §6).
 */
test.group('API key management', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('the owner can create a key and sees it once', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'pro'
    await organization.save()

    const response = await client
      .post('/settings/api-keys')
      .loginAs(user)
      .form({ 'name': 'Nightly sync', 'scopes[]': 'lists:read' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const stored = await ApiKey.query().firstOrFail()
    assert.equal(stored.name, 'Nightly sync')
    assert.deepEqual(stored.scopes, ['lists:read'])
    assert.equal(stored.createdByUserId, user.id)
    assert.match(stored.publicId, /^key_/)
  })

  test('a member cannot reach the API keys screen', async ({ client }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'pro'
    await organization.save()

    const member = await addMember(organization, user, 'sam@example.com')

    const response = await client.get('/settings/api-keys').loginAs(member).redirects(0)

    response.assertStatus(302)
    response.assertFlashMessage('error', 'Only the workspace owner can do that.')
  })

  /**
   * Free has `apiKeys: 0`, which means "not on this plan" rather than "none
   * yet" — so it is a 402, and the screen says so instead of showing an
   * empty list with a broken button.
   */
  test('a plan with no API keys refuses to mint one', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    const response = await client
      .post('/settings/api-keys')
      .loginAs(user)
      .form({ 'name': 'Nope', 'scopes[]': 'lists:read' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.lengthOf(await ApiKey.all(), 0)
  })

  test('the plan caps how many keys exist', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'pro'
    organization.limitOverrides = { apiKeys: 2 }
    await organization.save()

    await apiKeys.create(organization, user, { name: 'one' })
    await apiKeys.create(organization, user, { name: 'two' })

    const { default: PlanLimitExceededException } =
      await import('#exceptions/plan_limit_exceeded_exception')

    await assert.rejects(
      () => apiKeys.create(organization, user, { name: 'three' }),
      PlanLimitExceededException
    )
  })

  /**
   * Revoking is how a customer frees a slot, so a retired key must stop
   * counting.
   */
  test('revoking frees a slot', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'pro'
    organization.limitOverrides = { apiKeys: 1 }
    await organization.save()

    const { apiKey } = await apiKeys.create(organization, user, { name: 'one' })
    await apiKeys.revoke(apiKey)

    const replacement = await apiKeys.create(organization, user, { name: 'two' })
    assert.equal(replacement.apiKey.name, 'two')
  })

  /**
   * The row survives revocation: `api_requests` references it, and "what did
   * this key touch before we noticed" is the first question after a leak.
   */
  test('a revoked key is kept but not listed', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'pro'
    await organization.save()

    const { apiKey } = await apiKeys.create(organization, user, { name: 'leaked' })
    await apiKeys.revoke(apiKey)

    assert.lengthOf(await ApiKey.all(), 1, 'the row is still there')
    assert.isEmpty(await apiKeys.forOrganization(organization), 'but off the screen')
  })

  test('a key with no scopes is refused', async ({ assert }) => {
    const { user, organization } = await createWorkspace()

    organization.planKey = 'pro'
    await organization.save()

    const { ApiKeyError } = await import('#api/api_key_service')

    await assert.rejects(
      () => apiKeys.create(organization, user, { name: 'useless', scopes: [] }),
      ApiKeyError
    )
  })
})

/**
 * Usage tracking (plan §11).
 */
test.group('API request logging', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('echoes a request id and records the call', async ({ client, assert }) => {
    const { organization, apiKey, headers } = await createApiWorkspace()

    const response = await client.get('/api/v1/lists').headers(headers)

    const requestId = response.header('x-request-id')
    assert.isString(requestId)

    /**
     * Recorded outside the response, so give it a moment to land — the write
     * is deliberately not awaited so it cannot delay the customer.
     */
    await new Promise((resolve) => setTimeout(resolve, 50))

    const recorded = await ApiRequest.query().firstOrFail()
    assert.equal(recorded.organizationId, organization.id)
    assert.equal(recorded.apiKeyId, apiKey.id)
    assert.equal(recorded.method, 'GET')
    assert.equal(recorded.status, 200)
    assert.equal(recorded.requestId, requestId)
  })

  test('reuses the client’s request id so a trace crosses both systems', async ({
    client,
    assert,
  }) => {
    const { headers } = await createApiWorkspace()

    const response = await client
      .get('/api/v1/lists')
      .headers({ ...headers, 'x-request-id': 'their-trace-id' })

    assert.equal(response.header('x-request-id'), 'their-trace-id')
  })

  /**
   * A 402 is exactly the response somebody asks support about, so it has to
   * be in the table — which is why tracking runs outside authentication.
   */
  test('records a refused call too', async ({ client, assert }) => {
    const { organization, headers } = await createApiWorkspace()

    organization.planKey = 'free'
    await organization.save()

    const response = await client.get('/api/v1/lists').headers(headers)
    response.assertStatus(402)

    await new Promise((resolve) => setTimeout(resolve, 50))

    const recorded = await ApiRequest.query().firstOrFail()
    assert.equal(recorded.status, 402)
  })

  /**
   * An unauthenticated request has nothing to attribute, and a row per
   * anonymous call would be a free write endpoint for anybody with the URL.
   */
  test('does not record an unauthenticated call', async ({ client, assert }) => {
    await client.get('/api/v1/lists')

    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.lengthOf(await ApiRequest.all(), 0)
  })
})
