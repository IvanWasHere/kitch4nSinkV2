import { test } from '@japa/runner'
import { type DateTime } from 'luxon'

import twoFactor from '#auth/two_factor_service'
import { totpFor } from '#tests/helpers'

/**
 * A stand-in for the shape both User and StaffUser present. Keeping the unit
 * tests off the models is what proves the service really is model-agnostic.
 */
function subject() {
  return {
    email: 'jane@example.com',
    twoFactorSecret: null as string | null,
    twoFactorRecoveryCodes: null as string[] | null,
    twoFactorConfirmedAt: null as DateTime | null,
    async save() {},
  }
}

/**
 * The fixed development code is an authentication bypass, gated on
 * NODE_ENV being `development` *and* on DEV_TWO_FACTOR_CODE being set.
 *
 * The suite runs under NODE_ENV=test, so the first gate is shut here no
 * matter what the second says. Setting the variable and watching the code
 * still be refused is what proves the gate is the environment and not merely
 * the absence of the variable — the failure mode worth catching is someone
 * widening `app.inDev` to "not production" and silently enabling `123456`
 * everywhere that is not a live deployment.
 */
test.group('TwoFactorService — fixed development code', (group) => {
  group.each.setup(() => {
    const original = process.env.DEV_TWO_FACTOR_CODE
    process.env.DEV_TWO_FACTOR_CODE = '123456'

    return () => {
      if (original === undefined) {
        delete process.env.DEV_TWO_FACTOR_CODE
      } else {
        process.env.DEV_TWO_FACTOR_CODE = original
      }
    }
  })

  test('is refused outside development, even when configured', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    await twoFactor.confirmEnrolment(user, await totpFor(secret))

    assert.isFalse(await twoFactor.verify(user, '123456'))
  })

  test('does not make enrolment confirmable with it either', async ({ assert }) => {
    const user = subject()
    await twoFactor.beginEnrolment(user)

    assert.isNull(await twoFactor.confirmEnrolment(user, '123456'))
    assert.isNull(user.twoFactorConfirmedAt)
  })

  test('a real code still works while it is configured', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    await twoFactor.confirmEnrolment(user, await totpFor(secret))

    assert.isTrue(await twoFactor.verify(user, await totpFor(secret)))
  })
})

test.group('TwoFactorService', () => {
  test('enrolment stores a secret but leaves it unconfirmed', async ({ assert }) => {
    const user = subject()
    const { secret, qrCodeSvg, uri } = await twoFactor.beginEnrolment(user)

    assert.equal(user.twoFactorSecret, secret)
    assert.isNull(user.twoFactorConfirmedAt)
    assert.include(uri, 'otpauth://totp/')
    assert.include(qrCodeSvg, '<svg')
  })

  test('confirms with a valid code and returns eight recovery codes', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)

    const codes = await twoFactor.confirmEnrolment(user, await totpFor(secret))

    assert.lengthOf(codes!, 8)
    assert.isNotNull(user.twoFactorConfirmedAt)
  })

  test('rejects a wrong code', async ({ assert }) => {
    const user = subject()
    await twoFactor.beginEnrolment(user)

    assert.isNull(await twoFactor.confirmEnrolment(user, '000000'))
    assert.isNull(user.twoFactorConfirmedAt)
  })

  test('rejects codes that are not six digits', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    await twoFactor.confirmEnrolment(user, await totpFor(secret))

    assert.isFalse(await twoFactor.verify(user, '12345'))
    assert.isFalse(await twoFactor.verify(user, 'abcdef'))
    assert.isFalse(await twoFactor.verify(user, ''))
  })

  test('tolerates spaces in a pasted code', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    await twoFactor.confirmEnrolment(user, await totpFor(secret))

    const code = await totpFor(secret)
    assert.isTrue(await twoFactor.verify(user, `${code.slice(0, 3)} ${code.slice(3)}`))
  })

  /**
   * A secret that was generated but never confirmed must not protect the
   * account — otherwise a failed QR scan locks its owner out.
   */
  test('does not verify against an unconfirmed secret', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)

    assert.isFalse(await twoFactor.verify(user, await totpFor(secret)))
  })

  test('recovery codes are stored hashed and spend once', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    const codes = (await twoFactor.confirmEnrolment(user, await totpFor(secret)))!

    assert.notInclude(user.twoFactorRecoveryCodes!, codes[0])
    assert.isTrue(await twoFactor.consumeRecoveryCode(user, codes[0]))
    assert.isFalse(await twoFactor.consumeRecoveryCode(user, codes[0]))
    assert.lengthOf(user.twoFactorRecoveryCodes!, 7)
  })

  test('recovery codes ignore casing and surrounding space', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    const codes = (await twoFactor.confirmEnrolment(user, await totpFor(secret)))!

    assert.isTrue(await twoFactor.consumeRecoveryCode(user, `  ${codes[0].toUpperCase()} `))
  })

  test('rejects an unknown recovery code', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    await twoFactor.confirmEnrolment(user, await totpFor(secret))

    assert.isFalse(await twoFactor.consumeRecoveryCode(user, 'aaaaa-bbbbb'))
  })

  test('disabling clears everything', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    await twoFactor.confirmEnrolment(user, await totpFor(secret))

    await twoFactor.disable(user)

    assert.isNull(user.twoFactorSecret)
    assert.isNull(user.twoFactorRecoveryCodes)
    assert.isNull(user.twoFactorConfirmedAt)
  })

  test('regenerating replaces every code', async ({ assert }) => {
    const user = subject()
    const { secret } = await twoFactor.beginEnrolment(user)
    const original = (await twoFactor.confirmEnrolment(user, await totpFor(secret)))!

    const replacement = await twoFactor.regenerateRecoveryCodes(user)

    assert.lengthOf(replacement, 8)
    assert.isFalse(await twoFactor.consumeRecoveryCode(user, original[0]))
    assert.isTrue(await twoFactor.consumeRecoveryCode(user, replacement[0]))
  })
})
