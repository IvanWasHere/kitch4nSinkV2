import { DateTime } from 'luxon'
import { BaseSeeder } from '@adonisjs/lucid/seeders'

import User from '#models/user'
import StaffUser from '#models/staff_user'
import Organization from '#models/organization'
import twoFactor from '#auth/two_factor_service'
import invitations from '#organizations/invitation_service'
import registration from '#auth/registration_service'

/**
 * Fixed accounts for manual testing.
 *
 * Four addresses, each used exactly once. Two are employees of the SaaS —
 * they live in `staff_users` and sign in at /admin/login (D5). Two are
 * customers in one workspace, and sign in at /login.
 *
 *   admin@example.com        Admin12345      /admin/login   staff, admin
 *   support@example.com      Support12345    /admin/login   staff, support
 *   user-manager@example.com Manager12345    /login         workspace owner
 *   user@example.com         User12345       /login         workspace member
 *
 * Deliberately a seeder rather than a migration. A migration runs everywhere,
 * including the production release phase, so inserting accounts with published
 * passwords from one would put them on the live database — and dropping the
 * migration later would not remove the rows it had already created. Seeders
 * are skipped entirely outside the environments listed below, so these
 * credentials cannot reach production even by accident.
 *
 *   node ace db:seed                     — add them to the current database
 *   node ace migration:fresh --seed      — rebuild the database and add them
 *
 * Re-running is safe: existing accounts are left alone rather than duplicated.
 */
export default class extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    const organization = await this.createWorkspaceOwner()
    await this.createMember(organization)

    await this.createStaff('admin@example.com', 'Admin12345', 'admin', 'Admin Example')
    await this.createStaff('support@example.com', 'Support12345', 'support', 'Support Example')
  }

  /**
   * The workspace and the person who runs it.
   *
   * "Manager" maps onto the `owner` role rather than a third role: billing,
   * inviting and removing people are exactly what §6 grants an owner, and
   * there is one owner per organisation (D1). A separate manager role would
   * be a schema change that buys nothing the owner role does not already do.
   *
   * Built through the real registration service, so the organisation and its
   * owner are created exactly as a signup creates them rather than by
   * inserting rows that a code change could leave inconsistent.
   */
  private async createWorkspaceOwner(): Promise<Organization> {
    const email = 'user-manager@example.com'
    const existing = await User.findBy('email', email)

    if (existing) {
      this.log(`${email} already exists — left alone`)
      return Organization.findOrFail(existing.organizationId)
    }

    const { user, organization } = await registration.register({
      fullName: 'Morgan Manager',
      email,
      /**
       * Set on the model directly. The 12-character minimum belongs to the
       * signup and reset *validators*, and sign-in does not re-check length,
       * so a shorter password still works here — but these accounts cannot
       * set the same password through the UI.
       */
      password: 'Manager12345',
      organizationName: 'Example Workspace',
    })

    /**
     * Skip the confirmation email: unverified, the account is stuck on the
     * "check your email" screen, which is not what these accounts are for.
     */
    user.emailVerifiedAt = DateTime.utc()
    await user.save()

    /**
     * Free allows two seats, which the owner and the member below fill
     * exactly. A staff-style override (plan §7.4) leaves room to invite more
     * people while testing the team screens.
     */
    const workspace = await Organization.findOrFail(organization.id)
    workspace.limitOverrides = { seats: 5 }
    await workspace.save()

    this.log(`${email} / Manager12345  →  /login         owner of "${workspace.name}"`)

    return workspace
  }

  /**
   * An ordinary customer in the same workspace, so the owner-only rules have
   * something to be tested against: signed in as this account the team screen
   * has no invite or remove buttons, billing is absent from the nav, and the
   * workspace settings form is read-only.
   *
   * Added through the invitation flow rather than by inserting a row, so it
   * exercises the path a real member takes.
   */
  private async createMember(organization: Organization) {
    const email = 'user@example.com'

    if (await User.findBy('email', email)) {
      this.log(`${email} already exists — left alone`)
      return
    }

    const owner = await User.findOrFail(organization.ownerId!)
    const { token } = await invitations.invite({ organization, invitedBy: owner, email })

    await invitations.accept({ token, fullName: 'User Example', password: 'User12345' })

    this.log(`${email} / User12345      →  /login         member of "${organization.name}"`)
  }

  /**
   * An employee of the SaaS, on their own table behind their own login (D5).
   *
   * Two-factor is mandatory for staff (plan §12) and is not relaxed here — an
   * account that could skip it would be testing a different application to the
   * one that ships. It is enrolled up front so the account is usable, and
   * `node ace dev:totp <email>` prints a valid code on demand.
   */
  private async createStaff(
    email: string,
    password: string,
    role: 'admin' | 'support',
    fullName: string
  ) {
    if (await StaffUser.findBy('email', email)) {
      this.log(`${email} already exists — left alone`)
      return
    }

    /**
     * One address, one account. A staff member sharing an address with a
     * customer is two identities behind two guards, which is exactly the
     * confusion that makes "the credentials are not recognised" impossible to
     * diagnose.
     */
    if (await User.findBy('email', email)) {
      this.log(`${email} is already a customer account — skipped`)
      return
    }

    const staff = await StaffUser.create({ email, password, fullName, role })

    const { secret } = await twoFactor.beginEnrolment(staff)
    const { generate } = await import('otplib')
    await twoFactor.confirmEnrolment(staff, await generate({ secret }))

    this.log(`${email} / ${password}  →  /admin/login   staff, ${role}`)
  }

  private log(message: string) {
    console.log(`  ${message}`)
  }
}
