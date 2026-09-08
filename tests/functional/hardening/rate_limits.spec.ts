import { test } from '@japa/runner'

import { createStaff, createWorkspace, TEST_PASSWORD } from '#tests/helpers'

/**
 * The limits themselves live in `start/limiter.ts`; these prove they are
 * *attached*, which is the part that silently stops being true when a route
 * is moved between groups.
 *
 * The suite clears the limiter between tests (tests/bootstrap.ts), so each of
 * these starts with a full allowance.
 */
test.group('Rate limits on the auth surface', () => {
  test('refuses sign-in attempts once the limit is spent', async ({ client, assert }) => {
    await createWorkspace({ email: 'jane@example.com' })

    /**
     * Ten attempts are allowed per address and account. The eleventh is the
     * one under test; the ten before it are wrong on purpose, because a
     * correct one would create a session and change what is being measured.
     */
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await client
        .post('/login')
        .form({ email: 'jane@example.com', password: 'not-the-password' })
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
    }

    const refused = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    /**
     * A form is sent back to itself with the reason flashed, rather than
     * being answered with a bare 429 (`app/exceptions/handler.ts`).
     */
    refused.assertStatus(302)
    refused.assertFlashMessage('error', 'Too many sign-in attempts. Try again in a few minutes.')
    assert.isString(refused.header('retry-after'))

    /**
     * And the correct password did *not* sign them in: the refusal happens
     * before the controller runs.
     */
    refused.assertSessionMissing('auth_web')
  })

  test('counts sign-in attempts per account, not across all of them', async ({ client }) => {
    await createWorkspace({ email: 'jane@example.com' })
    await createWorkspace({ email: 'ada@example.com' })

    for (let attempt = 0; attempt < 10; attempt++) {
      await client
        .post('/login')
        .form({ email: 'jane@example.com', password: 'not-the-password' })
        .withCsrfToken()
        .redirects(0)
    }

    /**
     * Somebody else signing in from the same office is unaffected — the
     * reason the key is the pair and not just the address.
     */
    const other = await client
      .post('/login')
      .form({ email: 'ada@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    other.assertHeader('location', '/dashboard')
  })

  test('caps how many reset emails one address can ask for', async ({ client }) => {
    await createWorkspace({ email: 'jane@example.com' })

    for (let attempt = 0; attempt < 3; attempt++) {
      await client
        .post('/forgot-password')
        .form({ email: 'jane@example.com' })
        .withCsrfToken()
        .redirects(0)
    }

    const refused = await client
      .post('/forgot-password')
      .form({ email: 'jane@example.com' })
      .withCsrfToken()
      .redirects(0)

    refused.assertFlashMessage(
      'error',
      'A reset link has already been sent. Check your inbox, or try again later.'
    )
  })

  test('caps registrations from one address', async ({ client }) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await client
        .post('/signup')
        .form({
          fullName: 'Jane Cooper',
          email: `jane${attempt}@example.com`,
          organizationName: 'Acme',
          password: TEST_PASSWORD,
          passwordConfirmation: TEST_PASSWORD,
        })
        .withCsrfToken()
        .redirects(0)
    }

    const refused = await client
      .post('/signup')
      .form({
        fullName: 'Jane Cooper',
        email: 'jane-again@example.com',
        organizationName: 'Acme',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    refused.assertFlashMessage('error', 'Too many accounts created from here. Try again later.')
  })

  /**
   * The back-office is the tighter of the two logins, deliberately (D5).
   */
  test('refuses back-office sign-in attempts sooner', async ({ client }) => {
    await createStaff({ email: 'staff@acme.test' })

    for (let attempt = 0; attempt < 5; attempt++) {
      await client
        .post('/admin/login')
        .form({ email: 'staff@acme.test', password: 'not-the-password' })
        .withCsrfToken()
        .redirects(0)
    }

    const refused = await client
      .post('/admin/login')
      .form({ email: 'staff@acme.test', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    refused.assertFlashMessage('error', 'Too many sign-in attempts.')
    refused.assertSessionMissing('auth_staff')
  })
})
