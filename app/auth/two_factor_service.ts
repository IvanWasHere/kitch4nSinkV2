import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { DateTime } from 'luxon'
import QRCode from 'qrcode'
import { generateSecret, generateURI, verify } from 'otplib'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'

/**
 * TOTP two-factor, shared by tenant users and staff.
 *
 * The model columns it operates on (`twoFactorSecret`,
 * `twoFactorRecoveryCodes`, `twoFactorConfirmedAt`) are identical on `users`
 * and `staff_users`, so this service is typed against that shape rather than
 * against either model — one implementation, two guards.
 */
export interface TwoFactorSubject {
  email: string
  twoFactorSecret: string | null
  twoFactorRecoveryCodes: string[] | null
  twoFactorConfirmedAt: DateTime | null
  save(): Promise<any>
}

/**
 * A single time step of tolerance either side, so a code entered as it rolls
 * over is still accepted. Wider windows meaningfully weaken TOTP.
 */
const EPOCH_TOLERANCE = 1

const RECOVERY_CODE_COUNT = 8

export class TwoFactorService {
  /**
   * Start enrolment: generate a secret and store it *unconfirmed*.
   *
   * The account is not protected yet — `twoFactorConfirmedAt` stays null
   * until the user proves they can produce a code. Enabling on generation is
   * how people lock themselves out when the QR scan silently failed.
   */
  async beginEnrolment(
    subject: TwoFactorSubject
  ): Promise<{ secret: string; qrCodeSvg: string; uri: string }> {
    const secret = generateSecret()

    subject.twoFactorSecret = secret
    subject.twoFactorConfirmedAt = null
    await subject.save()

    const uri = this.uri(subject, secret)

    return { secret, uri, qrCodeSvg: await this.qrCode(uri) }
  }

  /**
   * Finish enrolment against a code from the user's authenticator app.
   * Returns the recovery codes, which are shown exactly once.
   */
  async confirmEnrolment(subject: TwoFactorSubject, token: string): Promise<string[] | null> {
    if (!subject.twoFactorSecret) {
      return null
    }

    if (!(await this.verifyToken(subject.twoFactorSecret, token))) {
      return null
    }

    const codes = this.generateRecoveryCodes()

    subject.twoFactorRecoveryCodes = codes.map((code) => this.hashRecoveryCode(code))
    subject.twoFactorConfirmedAt = DateTime.utc()
    await subject.save()

    return codes
  }

  /**
   * Verify a code at the login challenge.
   */
  async verify(subject: TwoFactorSubject, token: string): Promise<boolean> {
    if (!subject.twoFactorSecret || !subject.twoFactorConfirmedAt) {
      return false
    }

    return this.verifyToken(subject.twoFactorSecret, token)
  }

  /**
   * Spend a recovery code. Codes are stored hashed and each one works once —
   * a recovery code that survived use would be a permanent bypass.
   */
  async consumeRecoveryCode(subject: TwoFactorSubject, code: string): Promise<boolean> {
    const stored = subject.twoFactorRecoveryCodes
    if (!stored || stored.length === 0) {
      return false
    }

    const presented = this.hashRecoveryCode(code)
    const remaining = stored.filter((hash) => !this.hashesMatch(hash, presented))

    if (remaining.length === stored.length) {
      return false
    }

    subject.twoFactorRecoveryCodes = remaining
    await subject.save()

    return true
  }

  /**
   * Turn two-factor off entirely, clearing the secret and the codes.
   */
  async disable(subject: TwoFactorSubject): Promise<void> {
    subject.twoFactorSecret = null
    subject.twoFactorRecoveryCodes = null
    subject.twoFactorConfirmedAt = null
    await subject.save()
  }

  /**
   * Issue a fresh set of recovery codes, invalidating the old ones.
   */
  async regenerateRecoveryCodes(subject: TwoFactorSubject): Promise<string[]> {
    const codes = this.generateRecoveryCodes()

    subject.twoFactorRecoveryCodes = codes.map((code) => this.hashRecoveryCode(code))
    await subject.save()

    return codes
  }

  uri(subject: Pick<TwoFactorSubject, 'email'>, secret: string, issuer = 'Acme'): string {
    return generateURI({ issuer, label: subject.email, secret })
  }

  async qrCode(uri: string): Promise<string> {
    return QRCode.toString(uri, { type: 'svg', margin: 0, width: 180 })
  }

  private async verifyToken(secret: string, token: string): Promise<boolean> {
    const normalised = token.replace(/\s/g, '')

    if (!/^\d{6}$/.test(normalised)) {
      return false
    }

    if (this.acceptsFixedDevelopmentCode(normalised)) {
      logger.warn('accepted the fixed development two-factor code — DEV_TWO_FACTOR_CODE is set')
      return true
    }

    const result = await verify({ secret, token: normalised, epochTolerance: EPOCH_TOLERANCE })
    return result.valid
  }

  /**
   * A fixed code standing in for an authenticator app while developing, so
   * the seeded accounts can be signed into without one.
   *
   * This is an authentication bypass, so it has two independent gates and
   * both must hold:
   *
   *   1. `NODE_ENV` is exactly `development`. Production is excluded, and so
   *      is the test suite — which is why the two-factor tests still exercise
   *      real TOTP rather than quietly passing on this.
   *   2. `DEV_TWO_FACTOR_CODE` is set. It lives in `.env`, which is not
   *      deployed, so a production environment has nothing to read.
   *
   * Either gate alone would do; both are here because the cost of getting it
   * wrong is every account on the system. Each use is logged at warn level, so
   * an environment where this is unexpectedly live says so out loud rather
   * than silently accepting `123456` forever.
   */
  private acceptsFixedDevelopmentCode(token: string): boolean {
    if (!app.inDev) {
      return false
    }

    const fixedCode = env.get('DEV_TWO_FACTOR_CODE')

    return Boolean(fixedCode) && token === fixedCode
  }

  private generateRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = randomBytes(5).toString('hex')
      return `${raw.slice(0, 5)}-${raw.slice(5)}`
    })
  }

  private hashRecoveryCode(code: string): string {
    return createHash('sha256').update(code.trim().toLowerCase()).digest('hex')
  }

  private hashesMatch(a: string, b: string): boolean {
    const left = Buffer.from(a, 'hex')
    const right = Buffer.from(b, 'hex')
    return left.length === right.length && timingSafeEqual(left, right)
  }
}

export default new TwoFactorService()
