import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Prints a currently-valid TOTP code for a user, so a developer can walk
 * through the two-factor screens without an authenticator app on hand.
 *
 * Development only — it refuses to run outside it, because printing a live
 * second factor is exactly the thing two-factor exists to prevent.
 */
export default class DevTotp extends BaseCommand {
  static commandName = 'dev:totp'
  static description = 'Print a valid TOTP code for a user (development only)'

  static options: CommandOptions = {
    startApp: true,
  }

  @args.string({ description: 'Email address of the user or staff member' })
  declare email: string

  async run() {
    if (!this.app.inDev) {
      this.logger.error('dev:totp only runs in development')
      this.exitCode = 1
      return
    }

    const { default: User } = await import('#models/user')
    const { default: StaffUser } = await import('#models/staff_user')
    const { generate } = await import('otplib')

    const email = this.email.trim().toLowerCase()

    /**
     * An address identifies exactly one account, but staff and customers are
     * separate tables (D5), so both are checked.
     */
    const subject = (await User.findBy('email', email)) ?? (await StaffUser.findBy('email', email))

    if (!subject) {
      this.logger.error(`No account for ${email}`)
      this.exitCode = 1
      return
    }

    if (!subject.twoFactorSecret) {
      this.logger.error(`${email} has no two-factor secret`)
      this.exitCode = 1
      return
    }

    this.logger.log(await generate({ secret: subject.twoFactorSecret }))
  }
}
