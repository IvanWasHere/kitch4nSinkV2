import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import AuthToken from '#models/auth_token'
import authTokens from '#auth/auth_token_service'
import VerifyEmailNotification from '#mail/mails/verify_email_notification'
import { createWorkspace } from '#tests/helpers'

test.group('Email verification', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('confirms the address from the emailed link', async ({ client, assert }) => {
    const { user } = await createWorkspace({ verified: false })
    const token = await authTokens.issue(user, 'verify_email')

    const response = await client.get(`/verify-email/${token}`).redirects(0)

    response.assertHeader('location', '/dashboard')
    await user.refresh()
    assert.isNotNull(user.emailVerifiedAt)
  })

  /**
   * People read mail on a phone and click the link in a browser that has
   * never seen this site — the token is the credential, not the session.
   */
  test('works without an existing session, and signs the user in', async ({ client }) => {
    const { user } = await createWorkspace({ verified: false })
    const token = await authTokens.issue(user, 'verify_email')

    const response = await client.get(`/verify-email/${token}`).redirects(0)

    response.assertSession('auth_web', user.id)
  })

  test('refuses a token that has already been used', async ({ client, assert }) => {
    const { user } = await createWorkspace({ verified: false })
    const token = await authTokens.issue(user, 'verify_email')

    await client.get(`/verify-email/${token}`).redirects(0)
    const second = await client.get(`/verify-email/${token}`).redirects(0)

    second.assertHeader('location', '/verify-email')
    second.assertFlashMessage(
      'error',
      'That confirmation link has expired or has already been used.'
    )
    const record = await AuthToken.findByOrFail('user_id', user.id)
    assert.isTrue(record.isConsumed)
  })

  test('refuses a made-up token', async ({ client }) => {
    const response = await client.get('/verify-email/not-a-real-token').redirects(0)
    response.assertHeader('location', '/verify-email')
  })

  test('issuing a new link retires the previous one', async ({ client, assert }) => {
    const { user } = await createWorkspace({ verified: false })
    const first = await authTokens.issue(user, 'verify_email')
    const second = await authTokens.issue(user, 'verify_email')

    const stale = await client.get(`/verify-email/${first}`).redirects(0)
    stale.assertHeader('location', '/verify-email')

    const fresh = await client.get(`/verify-email/${second}`).redirects(0)
    fresh.assertHeader('location', '/dashboard')

    await user.refresh()
    assert.isNotNull(user.emailVerifiedAt)
  })

  test('resends a link on request', async ({ client }) => {
    const { mails } = mail.fake()
    const { user } = await createWorkspace({ verified: false })

    const response = await client
      .post('/verify-email/resend')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/verify-email')
    mails.assertSent(VerifyEmailNotification)
  })

  test('keeps unverified users out of the application', async ({ client }) => {
    const { user } = await createWorkspace({ verified: false })

    const response = await client.get('/settings/profile').loginAs(user).redirects(0)

    response.assertHeader('location', '/verify-email')
  })

  test('lets verified users through', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/settings/profile').loginAs(user)

    response.assertStatus(200)
  })
})
