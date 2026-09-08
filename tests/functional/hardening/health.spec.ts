import { test } from '@japa/runner'

/**
 * Liveness and readiness (plan §16). What matters about these is what they
 * *do not* do: liveness never touches a dependency, and neither says anything
 * about the deployment to whoever asks.
 */
test.group('Health endpoints', () => {
  test('liveness answers without touching a dependency', async ({ client }) => {
    const response = await client.get('/health')

    response.assertStatus(200)
    response.assertBody({ status: 'ok' })
  })

  test('readiness reports each dependency it checked', async ({ client }) => {
    const response = await client.get('/ready')

    response.assertStatus(200)
    response.assertBody({
      status: 'ok',
      checks: { database: 'ok', storage: 'ok' },
    })
  })

  test('neither needs a session', async ({ client }) => {
    const live = await client.get('/health').redirects(0)
    const ready = await client.get('/ready').redirects(0)

    live.assertStatus(200)
    ready.assertStatus(200)
  })
})
