import { test } from '@japa/runner'
import hash from '@adonisjs/core/services/hash'
import mail from '@adonisjs/mail/services/main'

import authTokens from '#auth/auth_token_service'
import { createWorkspace, enableTwoFactor, queuedMailsTo, TEST_PASSWORD } from '#tests/helpers'

const NEW_PASSWORD = 'a-brand-new-password'

test.group('Password reset', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('emails a reset link for a known address', async ({ client, assert }) => {
    await createWorkspace({ email: 'jane@example.com' })

    await client
      .post('/forgot-password')
      .form({ email: 'jane@example.com' })
      .withCsrfToken()
      .redirects(0)

    const [queued] = await queuedMailsTo('jane@example.com')

    assert.exists(queued)
    assert.equal(queued.subject, 'Reset your password')
    assert.include(queued.html, '/reset-password/')
  })

  /**
   * Saying "no account with that address" turns this form into an
   * account-enumeration oracle, so the response is identical either way.
   */
  test('gives the same answer for an unknown address', async ({ client, assert }) => {
    const known = await createWorkspace({ email: 'jane@example.com' })
    const first = await client
      .post('/forgot-password')
      .form({ email: known.user.email })
      .withCsrfToken()
      .redirects(0)

    const second = await client
      .post('/forgot-password')
      .form({ email: 'nobody@example.com' })
      .withCsrfToken()
      .redirects(0)

    first.assertFlashMessage(
      'success',
      'If an account exists for that address, a reset link is on its way.'
    )
    second.assertFlashMessage(
      'success',
      'If an account exists for that address, a reset link is on its way.'
    )
    second.assertStatus(first.status())

    assert.lengthOf(await queuedMailsTo('nobody@example.com'), 0, 'and only one email went out')
    assert.lengthOf(await queuedMailsTo('jane@example.com'), 1)
  })

  test('sets a new password from the link', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'reset_password')

    const response = await client
      .post(`/reset-password/${token}`)
      .form({ password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/dashboard')

    await user.refresh()
    assert.isTrue(await hash.verify(user.password!, NEW_PASSWORD))
    assert.isFalse(await hash.verify(user.password!, TEST_PASSWORD))
  })

  test('tells the account holder their password changed', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'reset_password')

    await client
      .post(`/reset-password/${token}`)
      .form({ password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    const queued = await queuedMailsTo(user.email)
    const notice = queued.find((message) => message.subject === 'Your password was changed')

    assert.exists(notice, 'a password-change notice is how someone learns their account was taken')
  })

  test('a reset link works exactly once', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'reset_password')

    await client
      .post(`/reset-password/${token}`)
      .form({ password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    const second = await client
      .post(`/reset-password/${token}`)
      .form({ password: 'another-password-here', passwordConfirmation: 'another-password-here' })
      .withCsrfToken()
      .redirects(0)

    second.assertHeader('location', '/forgot-password')

    await user.refresh()
    assert.isTrue(await hash.verify(user.password!, NEW_PASSWORD))
  })

  test('shows the form only while the link is valid', async ({ client }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'reset_password')

    const valid = await client.get(`/reset-password/${token}`)
    valid.assertStatus(200)

    await authTokens.consume(token, 'reset_password')

    const spent = await client.get(`/reset-password/${token}`).redirects(0)
    spent.assertHeader('location', '/forgot-password')
  })

  test('a verification token cannot be redeemed as a reset token', async ({ client }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'verify_email')

    const response = await client
      .post(`/reset-password/${token}`)
      .form({ password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/forgot-password')
  })

  /**
   * A reset link reaches the mailbox, and the point of the second factor is
   * that the mailbox is not enough.
   */
  test('does not bypass two-factor', async ({ client }) => {
    const { user } = await createWorkspace()
    await enableTwoFactor(user)
    const token = await authTokens.issue(user, 'reset_password')

    const response = await client
      .post(`/reset-password/${token}`)
      .form({ password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/login')
    response.assertSessionMissing('auth_web')
  })

  test('resetting also confirms the address', async ({ client, assert }) => {
    const { user } = await createWorkspace({ verified: false })
    const token = await authTokens.issue(user, 'reset_password')

    await client
      .post(`/reset-password/${token}`)
      .form({ password: NEW_PASSWORD, passwordConfirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    await user.refresh()
    assert.isNotNull(user.emailVerifiedAt)
  })
})
