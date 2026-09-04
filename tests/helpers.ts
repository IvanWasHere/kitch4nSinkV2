import { DateTime } from 'luxon'

import type User from '#models/user'
import type Organization from '#models/organization'
import registration from '#auth/registration_service'
import twoFactor from '#auth/two_factor_service'

export const TEST_PASSWORD = 'secret-password-12'

/**
 * Create an organisation and its owner through the real registration path, so
 * tests exercise the same code a signup does rather than a parallel fixture
 * that can drift from it.
 */
export async function createWorkspace(
  overrides: { email?: string; fullName?: string; verified?: boolean } = {}
): Promise<{ user: User; organization: Organization }> {
  const result = await registration.register({
    email: overrides.email ?? `owner-${Math.random().toString(36).slice(2, 10)}@example.com`,
    fullName: overrides.fullName ?? 'Jane Cooper',
    password: TEST_PASSWORD,
  })

  if (overrides.verified !== false) {
    result.user.emailVerifiedAt = DateTime.utc()
    await result.user.save()
  }

  return result
}

/**
 * Enrol and confirm two-factor for a subject, returning its secret and
 * recovery codes so a test can produce valid codes.
 */
export async function enableTwoFactor(subject: Parameters<typeof twoFactor.beginEnrolment>[0]) {
  const { secret } = await twoFactor.beginEnrolment(subject)
  const { generate } = await import('otplib')
  const token = await generate({ secret })
  const recoveryCodes = await twoFactor.confirmEnrolment(subject, token)

  return { secret, recoveryCodes: recoveryCodes ?? [] }
}

/**
 * A currently-valid TOTP code for a secret.
 */
export async function totpFor(secret: string): Promise<string> {
  const { generate } = await import('otplib')
  return generate({ secret })
}
