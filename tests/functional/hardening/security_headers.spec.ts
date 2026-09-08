import { test } from '@japa/runner'

import { createWorkspace } from '#tests/helpers'

/**
 * A policy nobody checks is a policy that gets deleted by a merge.
 *
 * These assert the shape of the headers rather than their exact text, so
 * tightening a directive does not fail the build — but removing one does.
 */
test.group('Security headers', () => {
  test('sends a content security policy that refuses unsigned inline scripts', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/login')

    const policy = response.header('content-security-policy')
    assert.isString(policy)

    /**
     * The nonce is the load-bearing part: it is what makes an injected
     * `<script>` inert while our own inline scripts still run.
     */
    assert.match(policy!, /script-src[^;]*'nonce-[^']+'/)
    assert.notInclude(policy!, `script-src 'self' 'unsafe-inline'`)

    /**
     * The three that are cheap to lose and expensive to be without: no
     * plugins, no framing, no re-pointing of relative URLs.
     */
    assert.include(policy!, `object-src 'none'`)
    assert.include(policy!, `frame-ancestors 'none'`)
    assert.include(policy!, `base-uri 'self'`)
  })

  test('gives each response its own nonce', async ({ client, assert }) => {
    const first = await client.get('/login')
    const second = await client.get('/login')

    const nonceOf = (policy: string) => policy.match(/'nonce-([^']+)'/)?.[1]

    const firstNonce = nonceOf(first.header('content-security-policy')!)
    const secondNonce = nonceOf(second.header('content-security-policy')!)

    assert.isString(firstNonce)
    assert.notEqual(firstNonce, secondNonce)
  })

  test('renders the nonce onto the script tags it allows', async ({ client, assert }) => {
    const response = await client.get('/login')

    const nonce = response.header('content-security-policy')!.match(/'nonce-([^']+)'/)?.[1]

    /**
     * Whatever the page emits as a script must carry the nonce this response
     * announced, or the browser drops it and the page arrives without
     * styles or behaviour.
     */
    for (const tag of response.text().match(/<script[^>]*>/g) ?? []) {
      assert.include(tag, `nonce="${nonce}"`)
    }
  })

  test('sends the headers Shield does not', async ({ client }) => {
    const response = await client.get('/login')

    response.assertHeader('referrer-policy', 'strict-origin-when-cross-origin')
    response.assertHeader('cross-origin-opener-policy', 'same-origin')
    response.assertHeader('x-permitted-cross-domain-policies', 'none')
    response.assertHeader('x-frame-options', 'DENY')
    response.assertHeader('x-content-type-options', 'nosniff')
  })

  /**
   * The server middleware stack, not the router one — so a URL nobody routed
   * is answered with the same protections.
   */
  test('sends them on a 404 too', async ({ client }) => {
    const response = await client.get('/wp-login.php')

    response.assertStatus(404)
    response.assertHeader('referrer-policy', 'strict-origin-when-cross-origin')
  })

  test('sends them on a signed-in page', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/dashboard').loginAs(user)

    response.assertHeader('x-frame-options', 'DENY')
  })
})
