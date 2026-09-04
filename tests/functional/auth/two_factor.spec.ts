import { test } from '@japa/runner'

import twoFactor from '#auth/two_factor_service'
import { createWorkspace, enableTwoFactor, totpFor, TEST_PASSWORD } from '#tests/helpers'

test.group('Two-factor authentication', () => {
  test('enrolment does not switch it on until a code is confirmed', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    await client.post('/settings/security/two-factor').loginAs(user).withCsrfToken().redirects(0)

    await user.refresh()
    assert.isNotNull(user.twoFactorSecret, 'a secret is stored')
    assert.isNull(user.twoFactorConfirmedAt, 'but the account is not protected yet')
    assert.isFalse(user.hasTwoFactor)
  })

  test('confirming with a valid code switches it on and issues recovery codes', async ({
    client,
    assert,
  }) => {
    const { user } = await createWorkspace()
    const { secret } = await twoFactor.beginEnrolment(user)

    const response = await client
      .post('/settings/security/two-factor/confirm')
      .loginAs(user)
      .form({ code: await totpFor(secret) })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/settings/security')

    await user.refresh()
    assert.isTrue(user.hasTwoFactor)
    assert.lengthOf(user.twoFactorRecoveryCodes!, 8)
  })

  test('a wrong code leaves it off', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    await twoFactor.beginEnrolment(user)

    await client
      .post('/settings/security/two-factor/confirm')
      .loginAs(user)
      .form({ code: '000000' })
      .withCsrfToken()
      .redirects(0)

    await user.refresh()
    assert.isFalse(user.hasTwoFactor)
  })

  test('the challenge completes sign-in with an authenticator code', async ({ client }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const { secret } = await enableTwoFactor(user)

    const login = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    const challenge = await client
      .post('/two-factor')
      .withSession(login.session())
      .form({ code: await totpFor(secret) })
      .withCsrfToken()
      .redirects(0)

    challenge.assertHeader('location', '/dashboard')
    challenge.assertSession('auth_web', user.id)
  })

  test('a recovery code also completes sign-in, and is then spent', async ({ client, assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const { recoveryCodes } = await enableTwoFactor(user)

    const login = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    const challenge = await client
      .post('/two-factor')
      .withSession(login.session())
      .form({ code: recoveryCodes[0] })
      .withCsrfToken()
      .redirects(0)

    challenge.assertSession('auth_web', user.id)

    await user.refresh()
    assert.lengthOf(user.twoFactorRecoveryCodes!, 7)
    assert.isFalse(await twoFactor.consumeRecoveryCode(user, recoveryCodes[0]))
  })

  test('a wrong code does not sign anyone in', async ({ client }) => {
    await createWorkspace({ email: 'jane@example.com' }).then(({ user }) => enableTwoFactor(user))

    const login = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    const challenge = await client
      .post('/two-factor')
      .withSession(login.session())
      .form({ code: '000000' })
      .withCsrfToken()
      .redirects(0)

    challenge.assertHeader('location', '/two-factor')
    challenge.assertSessionMissing('auth_web')
  })

  test('the challenge page is unreachable without a pending sign-in', async ({ client }) => {
    const response = await client.get('/two-factor').redirects(0)
    response.assertHeader('location', '/login')
  })

  test('turning it off clears the secret and the recovery codes', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    await enableTwoFactor(user)

    await client
      .post('/settings/security/two-factor/disable')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await user.refresh()
    assert.isNull(user.twoFactorSecret)
    assert.isNull(user.twoFactorRecoveryCodes)
    assert.isFalse(user.hasTwoFactor)
  })

  test('regenerating recovery codes invalidates the old ones', async ({ client, assert }) => {
    const { user } = await createWorkspace()
    const { recoveryCodes } = await enableTwoFactor(user)

    await client
      .post('/settings/security/two-factor/recovery-codes')
      .loginAs(user)
      .withCsrfToken()
      .redirects(0)

    await user.refresh()
    assert.lengthOf(user.twoFactorRecoveryCodes!, 8)
    assert.isFalse(await twoFactor.consumeRecoveryCode(user, recoveryCodes[0]))
  })

  /**
   * The database must never hold a usable TOTP secret in the clear.
   */
  test('the secret is encrypted at rest', async ({ assert }) => {
    const { user } = await createWorkspace()
    const { secret, recoveryCodes } = await enableTwoFactor(user)

    const { default: db } = await import('@adonisjs/lucid/services/db')
    const row = await db.from('users').where('id', user.id).firstOrFail()

    assert.isString(row.two_factor_secret)
    assert.notInclude(row.two_factor_secret, secret)
    assert.notInclude(row.two_factor_recovery_codes, recoveryCodes[0])
  })
})
