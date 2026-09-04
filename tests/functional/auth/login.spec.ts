import { test } from '@japa/runner'

import User from '#models/user'
import { createWorkspace, enableTwoFactor, TEST_PASSWORD } from '#tests/helpers'

test.group('Login', () => {
  test('signs a verified user in', async ({ client }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })

    const response = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/dashboard')
    response.assertSession('auth_web', user.id)
  })

  test('accepts an email in any casing', async ({ client }) => {
    await createWorkspace({ email: 'jane@example.com' })

    const response = await client
      .post('/login')
      .form({ email: '  JANE@Example.com ', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/dashboard')
  })

  test('rejects a wrong password without saying which field was wrong', async ({ client }) => {
    await createWorkspace({ email: 'jane@example.com' })

    const response = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: 'not-the-password' })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/login')
    response.assertFlashMessage('error', 'Those credentials do not match our records.')
  })

  test('rejects an unknown address with the same message', async ({ client }) => {
    const response = await client
      .post('/login')
      .form({ email: 'nobody@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'Those credentials do not match our records.')
  })

  test('records the sign-in time', async ({ client, assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    assert.isNotOk(user.lastLoginAt)

    await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    await user.refresh()
    assert.isNotNull(user.lastLoginAt)
  })

  /**
   * The password alone must not create a session when a second factor is
   * configured — this is the whole point of two-factor.
   */
  test('does not sign in a two-factor user on password alone', async ({ client }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    await enableTwoFactor(user)

    const response = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/two-factor')
    response.assertSessionMissing('auth_web')
  })

  test('sends an unverified user to the confirmation notice', async ({ client }) => {
    await createWorkspace({ email: 'jane@example.com', verified: false })

    await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    const response = await client
      .get('/dashboard')
      .loginAs(await User.findByOrFail('email', 'jane@example.com'))
      .redirects(0)

    response.assertHeader('location', '/verify-email')
  })

  test('signs out', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.post('/logout').loginAs(user).withCsrfToken().redirects(0)

    response.assertHeader('location', '/login')
  })
})
