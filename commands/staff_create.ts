import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Creates a staff account for the back-office (D5).
 *
 * Staff cannot self-register and there is no invitation flow for them — the
 * only way in is this command, run by someone with shell access. Two-factor
 * is mandatory for staff, so enrolment happens here too: without it the
 * account would be created and then permanently unable to sign in.
 */
export default class StaffCreate extends BaseCommand {
  static commandName = 'staff:create'
  static description = 'Create a staff account for the admin back-office'

  static options: CommandOptions = {
    startApp: true,
  }

  @flags.string({ description: 'Email address' })
  declare email: string

  @flags.string({ description: 'Full name' })
  declare name: string

  @flags.string({ description: 'admin | support', default: 'support' })
  declare role: string

  /**
   * Bootstrapping the first staff account in a container has no TTY, so the
   * password can be supplied as a flag. When it is, two-factor enrolment is
   * completed without asking for a code and the recovery codes are printed —
   * the operator can still scan the URI, and cannot be locked out either way.
   */
  @flags.string({ description: 'Password (skips the prompt; use for non-interactive setup)' })
  declare password: string

  @flags.boolean({
    description: 'Skip two-factor enrolment. The account cannot sign in until it is enrolled.',
    default: false,
  })
  declare skipTwoFactor: boolean

  async run() {
    const { default: StaffUser } = await import('#models/staff_user')
    const { default: twoFactor } = await import('#auth/two_factor_service')

    const email = this.email ?? (await this.prompt.ask('Email address'))
    const name = this.name ?? (await this.prompt.ask('Full name', { default: '' }))

    if (!['admin', 'support'].includes(this.role)) {
      this.logger.error(`Role must be "admin" or "support", got "${this.role}"`)
      this.exitCode = 1
      return
    }

    const normalised = email.trim().toLowerCase()

    const existing = await StaffUser.findBy('email', normalised)
    if (existing) {
      this.logger.error(`A staff account already exists for ${email}`)
      this.exitCode = 1
      return
    }

    /**
     * One address, one account. Staff and customers are separate tables
     * behind separate guards (D5), so the database cannot enforce this — but
     * an address that is both is two identities with two passwords and two
     * login pages, and no way for its owner to tell which one is failing.
     *
     * Checked here rather than at public signup: refusing an address there
     * would let anyone enumerate staff addresses from the registration form.
     */
    const { default: User } = await import('#models/user')
    if (await User.findBy('email', normalised)) {
      this.logger.error(`${email} is already a customer account. Use a different address.`)
      this.exitCode = 1
      return
    }

    const interactive = !this.password
    const password =
      this.password ??
      (await this.prompt.secure('Password', {
        validate: (value) => (value && value.length >= 12) || 'At least 12 characters',
      }))

    if (password.length < 12) {
      this.logger.error('Password must be at least 12 characters')
      this.exitCode = 1
      return
    }

    const staff = await StaffUser.create({
      email,
      password,
      fullName: name || null,
      role: this.role as 'admin' | 'support',
    })

    this.logger.success(`Created ${staff.role} account ${staff.email} (${staff.publicId})`)

    if (this.skipTwoFactor) {
      this.logger.warning(
        'Two-factor was skipped. This account cannot sign in until it is enrolled.'
      )
      return
    }

    const { uri, secret } = await twoFactor.beginEnrolment(staff)

    this.logger.info('Add this to an authenticator app:')
    this.logger.log('')
    this.logger.log(`  Secret: ${secret}`)
    this.logger.log(`  URI:    ${uri}`)
    this.logger.log('')

    const { generate } = await import('otplib')
    const code = interactive
      ? await this.prompt.ask('Enter the six-digit code to confirm enrolment', {
          validate: (value) => /^\d{6}$/.test(value?.trim() ?? '') || 'Six digits',
        })
      : await generate({ secret })

    if (!interactive) {
      this.logger.warning(
        'Enrolled without verifying a code. Scan the URI above, or use a recovery code below.'
      )
    }

    const recoveryCodes = await twoFactor.confirmEnrolment(staff, code)

    if (!recoveryCodes) {
      this.logger.error('That code was not valid. Re-run enrolment before signing in.')
      this.exitCode = 1
      return
    }

    this.logger.success('Two-factor enabled. Store these recovery codes somewhere safe:')
    this.logger.log('')
    for (const recoveryCode of recoveryCodes) {
      this.logger.log(`  ${recoveryCode}`)
    }
    this.logger.log('')
  }
}
