import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * Seeds a workspace with an owner, a member and a pending invitation, so the
 * team screens can be looked at without clicking through signup every time,
 * plus one workspace per paid tier with a subscription and some transaction
 * history — the billing screen is buildable before a Creem account exists
 * (plan §7.6).
 *
 * Development only.
 */
export default class DevSeed extends BaseCommand {
  static commandName = 'dev:seed'
  static description = 'Create demo workspaces, one per plan tier (development only)'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    if (!this.app.inDev) {
      this.logger.error('dev:seed only runs in development')
      this.exitCode = 1
      return
    }

    const { DateTime } = await import('luxon')
    const { default: registration } = await import('#auth/registration_service')
    const { default: invitations } = await import('#organizations/invitation_service')

    const { user, organization } = await registration.register({
      fullName: 'Jane Cooper',
      email: 'jane@example.com',
      password: 'correct-horse-battery',
      organizationName: 'Acme',
    })

    user.emailVerifiedAt = DateTime.utc()
    await user.save()

    /**
     * Free allows two seats, and the demo wants a member *and* a pending
     * invitation to look at, so the workspace gets a staff-style override.
     */
    organization.limitOverrides = { seats: 5 }
    await organization.save()

    const joining = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'sam@example.com',
    })
    await invitations.accept({
      token: joining.token,
      fullName: 'Sam Member',
      password: 'correct-horse-battery',
    })

    const pending = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'alex@example.com',
    })

    const env = await import('#start/env')

    /**
     * One workspace per paid tier, each with a live subscription and a few
     * charges behind it, so the billing screen, the usage meters and the
     * at-cap states can all be looked at without a payment provider
     * (plan §7.6).
     */
    await this.seedPaidWorkspace('pro', 'Pro Widgets', 'owner-pro@example.com')
    await this.seedPaidWorkspace('business', 'Business Widgets', 'owner-business@example.com')

    this.logger.success('Seeded Acme (free)')
    this.logger.log('  owner:   jane@example.com / correct-horse-battery')
    this.logger.log('  member:  sam@example.com / correct-horse-battery')
    this.logger.log('  invited: alex@example.com (pending)')
    this.logger.log('')
    this.logger.success('Seeded paid tiers')
    this.logger.log('  pro:      owner-pro@example.com / correct-horse-battery')
    this.logger.log('  business: owner-business@example.com / correct-horse-battery')
    this.logger.log('')
    /**
     * Only the hash of the token is stored, so this is the one moment the
     * link exists — printing it here saves reaching into Mailpit.
     */
    this.logger.log(`  invitation link: ${env.default.get('APP_URL')}/invitations/${pending.token}`)
  }

  /**
   * A workspace on a paid plan, with the rows a real subscription would have
   * left behind.
   *
   * The provider ids are obviously fake (`sub_seed_…`), which is deliberate:
   * pointing `billing:sync` at this data should report every one of them as
   * missing rather than look convincingly real.
   */
  private async seedPaidWorkspace(planKey: 'pro' | 'business', name: string, email: string) {
    const { DateTime } = await import('luxon')
    const { default: registration } = await import('#auth/registration_service')
    const { default: Payment } = await import('#models/payment')
    const { default: Subscription } = await import('#models/subscription')
    const { planFor } = await import('#config/plans')

    const { user, organization } = await registration.register({
      fullName: name,
      email,
      password: 'correct-horse-battery',
      organizationName: name,
    })

    user.emailVerifiedAt = DateTime.utc()
    await user.save()

    organization.planKey = planKey
    await organization.save()

    const periodStart = DateTime.utc().startOf('month')

    const subscription = await Subscription.create({
      organizationId: organization.id,
      provider: 'creem',
      providerSubscriptionId: `sub_seed_${planKey}`,
      providerCustomerId: `cus_seed_${planKey}`,
      planKey,
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodStart.plus({ months: 1 }),
      cancelAtPeriodEnd: false,
    })

    const plan = planFor(planKey)

    for (let month = 0; month < 3; month++) {
      const occurredAt = periodStart.minus({ months: month })

      await Payment.create({
        organizationId: organization.id,
        subscriptionId: subscription.id,
        provider: 'creem',
        providerOrderId: `ord_seed_${planKey}_${month}`,
        amountCents: plan.priceCents,
        currency: 'USD',
        status: 'succeeded',
        refundedAmountCents: 0,
        description: `${plan.name} plan — monthly`,
        occurredAt,
      })
    }
  }
}
