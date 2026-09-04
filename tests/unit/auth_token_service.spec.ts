import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'

import AuthToken from '#models/auth_token'
import authTokens from '#auth/auth_token_service'
import { createWorkspace } from '#tests/helpers'

test.group('AuthTokenService', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('stores only the hash, never the token', async ({ assert }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'verify_email')

    const row = await db.from('auth_tokens').where('user_id', user.id).firstOrFail()

    assert.notEqual(row.token_hash, token)
    assert.lengthOf(row.token_hash, 64, 'sha256 hex')
    assert.notInclude(JSON.stringify(row), token)
  })

  test('redeems a token once', async ({ assert }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'verify_email')

    const redeemed = await authTokens.consume(token, 'verify_email')
    assert.equal(redeemed?.id, user.id)
    assert.isNull(await authTokens.consume(token, 'verify_email'))
  })

  test('refuses a token of the wrong type', async ({ assert }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'verify_email')

    assert.isNull(await authTokens.consume(token, 'reset_password'))
  })

  test('refuses an expired token', async ({ assert }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'reset_password')

    const record = await AuthToken.findByOrFail('user_id', user.id)
    record.expiresAt = DateTime.utc().minus({ minutes: 1 })
    await record.save()

    assert.isNull(await authTokens.consume(token, 'reset_password'))
  })

  /**
   * Requesting a second reset link must retire the first, otherwise every
   * request leaves another working key sitting in a mailbox.
   */
  test('issuing a token retires the outstanding one of the same type', async ({ assert }) => {
    const { user } = await createWorkspace()
    const first = await authTokens.issue(user, 'reset_password')
    const second = await authTokens.issue(user, 'reset_password')

    assert.isNull(await authTokens.consume(first, 'reset_password'))
    assert.isNotNull(await authTokens.consume(second, 'reset_password'))
  })

  test('leaves tokens of other types alone', async ({ assert }) => {
    const { user } = await createWorkspace()
    const verification = await authTokens.issue(user, 'verify_email')
    await authTokens.issue(user, 'reset_password')

    assert.isNotNull(await authTokens.consume(verification, 'verify_email'))
  })

  test('reset tokens expire sooner than verification tokens', async ({ assert }) => {
    const { user } = await createWorkspace()
    await authTokens.issue(user, 'verify_email')
    await authTokens.issue(user, 'reset_password')

    const verification = await AuthToken.findByOrFail('type', 'verify_email')
    const reset = await AuthToken.findByOrFail('type', 'reset_password')

    assert.isBelow(reset.expiresAt.toMillis(), verification.expiresAt.toMillis())
  })

  test('refuses empty and unknown tokens', async ({ assert }) => {
    assert.isNull(await authTokens.consume('', 'verify_email'))
    assert.isNull(await authTokens.consume('nope', 'verify_email'))
    assert.isNull(await authTokens.find('', 'verify_email'))
  })

  test('find does not consume', async ({ assert }) => {
    const { user } = await createWorkspace()
    const token = await authTokens.issue(user, 'reset_password')

    assert.isNotNull(await authTokens.find(token, 'reset_password'))
    assert.isNotNull(await authTokens.consume(token, 'reset_password'))
  })
})
