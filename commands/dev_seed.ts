import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

import type User from '#models/user'
import type Organization from '#models/organization'

/**
 * A demo dataset: enough of everything that every screen shows what it is
 * for, rather than an empty state.
 *
 *   Acme               free, at its list cap, with a staff limit override
 *   Pro Widgets        pro, a team, lists and todos, API keys, files
 *   Business Widgets   business, the top tier
 *   Northwind Traders  pro but past due — the dunning banner and the
 *                      back-office's "needs attention" list
 *   Contoso Design     cancelled last month, so churn is not always zero
 *   + sixty-eight more forty ordinary paying customers, each billed on its
 *                      own day of the month, and twenty-eight free sign-ups,
 *                      so the volume chart has a full quarter to draw
 *
 * plus published announcements, a stuck webhook and a failed job, because the
 * operations screens are only legible with something on them (plan §7.6, §12).
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
      password: 'Example12345',
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
      password: 'Example12345',
    })

    const pending = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'alex@example.com',
    })

    await this.backdate(organization, user, 7)

    const { default: UserModel } = await import('#models/user')
    const member = await UserModel.findByOrFail('email', 'sam@example.com')

    const env = await import('#start/env')

    /**
     * One workspace per paid tier, each with a live subscription and a few
     * charges behind it, so the billing screen, the usage meters and the
     * at-cap states can all be looked at without a payment provider
     * (plan §7.6).
     */
    const pro = await this.seedPaidWorkspace(
      'pro',
      'Pro Widgets',
      'owner-pro@example.com',
      4,
      'Marguerite Hayes'
    )
    await this.seedPaidWorkspace(
      'business',
      'Business Widgets',
      'owner-business@example.com',
      2,
      'Kenji Okafor'
    )

    /**
     * The working week of the workspace the demo is toured in: a team, five
     * lists, todos at every state a todo has, two API keys with traffic
     * behind them, and a few files.
     */
    const proMembers = await this.seedProWorkspace(pro.organization, pro.user)

    /**
     * The two states nobody sets up by hand and every support screen is
     * built for.
     */
    await this.seedPastDueWorkspace()
    await this.seedChurnedWorkspace()

    /**
     * Enough paying customers, billed on enough different days, for the
     * back-office's volume chart to be a line rather than three dots.
     */
    const cohort = await this.seedBillingCohort()

    /**
     * Whatever the features registered in `start/seeders.ts` want to put in
     * these workspaces (plan §12). Runs here, after every workspace and
     * person exists, so a seeder can assign a row to a member and know they
     * are there.
     *
     * Their limit overrides are merged first: a meter is only worth showing
     * near its ceiling, and a plan's real ceiling is usually too high to
     * demonstrate against.
     */
    const { default: seeders } = await import('#seeding/demo_seeders')

    const context = {
      free: { organization, owner: user, members: [member] },
      pro: { organization: pro.organization, owner: pro.user, members: proMembers },
    }

    for (const [key, workspace] of Object.entries(context) as [
      keyof typeof context,
      (typeof context)[keyof typeof context],
    ][]) {
      const overrides = seeders.overridesFor(key)

      if (Object.keys(overrides).length > 0) {
        workspace.organization.limitOverrides = {
          ...(workspace.organization.limitOverrides ?? {}),
          ...overrides,
        }
        await workspace.organization.save()
      }
    }

    for (const seeder of seeders.all()) {
      await seeder.seed(context)
      this.logger.info(`seeded ${seeder.key}`)
    }

    await this.seedAnnouncements()
    await this.seedSupportTickets()
    await this.seedOperations()

    this.logger.success('Seeded Acme (free)')
    this.logger.log('  owner:   jane@example.com / Example12345')
    this.logger.log('  member:  sam@example.com / Example12345')
    this.logger.log('  invited: alex@example.com (pending)')
    this.logger.log('')
    this.logger.success('Seeded paid tiers')
    this.logger.log('  pro:      owner-pro@example.com / Example12345')
    this.logger.log('  business: owner-business@example.com / Example12345')
    this.logger.log('')
    this.logger.success('Seeded the states support screens exist for')
    this.logger.log('  past due:  owner-northwind@example.com (dunning banner, needs attention)')
    this.logger.log('  cancelled: owner-contoso@example.com (churn)')
    this.logger.log('  plus 3 announcements, 3 support tickets, a stuck webhook and a failed job')
    this.logger.log(
      `  and ${cohort.workspaces} more workspaces billed on ${cohort.billedDays} different days of the month,`
    )
    this.logger.log('  so the volume chart has charges, sign-ups and cancellations across 90 days')
    this.logger.log('')
    /**
     * Only the hash of the token is stored, so this is the one moment the
     * link exists — printing it here saves reaching into Mailpit.
     */
    this.logger.log(`  invitation link: ${env.default.get('APP_URL')}/invitations/${pending.token}`)
  }

  /**
   * Moves a workspace and its owner back in time.
   *
   * Everything a seeder creates is created in the same second, which makes
   * the back-office's growth chart a single bar and its "recent signups" a
   * list of identical dates (plan §12). Spreading the demo workspaces across
   * the year is what makes those screens show their shape at all.
   */
  private async backdate(organization: Organization, user: User, monthsAgo: number) {
    const { DateTime } = await import('luxon')
    const when = DateTime.utc().minus({ months: monthsAgo }).startOf('day').plus({ hours: 10 })

    organization.createdAt = when
    await organization.save()

    user.createdAt = when
    await user.save()
  }

  /**
   * A workspace on a paid plan, with the rows a real subscription would have
   * left behind.
   *
   * The provider ids are obviously fake (`sub_seed_…`), which is deliberate:
   * pointing `billing:sync` at this data should report every one of them as
   * missing rather than look convincingly real.
   */
  private async seedPaidWorkspace(
    planKey: 'pro' | 'business',
    name: string,
    email: string,
    monthsAgo: number,
    ownerName = 'Alex Chen',
    /**
     * How many days ago this workspace's billing day last came round. Left
     * out, it bills on the first of the month like the tour workspaces do.
     */
    billedDaysAgo?: number
  ): Promise<{ organization: Organization; user: User }> {
    const { DateTime } = await import('luxon')
    const { default: registration } = await import('#auth/registration_service')
    const { default: Payment } = await import('#models/payment')
    const { default: Subscription } = await import('#models/subscription')
    const { planFor } = await import('#config/plans')

    const { user, organization } = await registration.register({
      /* A person owns the workspace; the workspace is not a person. */
      fullName: ownerName,
      email,
      password: 'Example12345',
      organizationName: name,
    })

    user.emailVerifiedAt = DateTime.utc()
    await user.save()

    organization.planKey = planKey
    await organization.save()

    await this.backdate(organization, user, monthsAgo)

    const periodStart =
      billedDaysAgo === undefined
        ? DateTime.utc().startOf('month')
        : DateTime.utc().startOf('day').minus({ days: billedDaysAgo })

    const subscription = await Subscription.create({
      organizationId: organization.id,
      provider: 'creem',
      /*
       * Unique per workspace: two demo workspaces can be on the same plan,
       * and the provider's ids are unique in the real world too.
       */
      providerSubscriptionId: `sub_seed_${organization.slug}`,
      providerCustomerId: `cus_seed_${organization.slug}`,
      planKey,
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodStart.plus({ months: 1 }),
      cancelAtPeriodEnd: false,
    })

    const plan = planFor(planKey)

    for (let month = 0; month < Math.max(1, monthsAgo); month++) {
      const occurredAt = periodStart.minus({ months: month })

      await Payment.create({
        organizationId: organization.id,
        subscriptionId: subscription.id,
        provider: 'creem',
        providerOrderId: `ord_seed_${organization.slug}_${month}`,
        amountCents: plan.priceCents,
        currency: 'USD',
        status: 'succeeded',
        refundedAmountCents: 0,
        description: `${plan.name} plan — monthly`,
        occurredAt,
      })
    }

    /**
     * One charge that was partly given back. A refund never negates a row —
     * `refundedAmountCents` grows and the status moves — so this is also what
     * proves the billing history and the back-office's gross/net split are
     * reading it that way.
     */
    if (planKey === 'pro' && monthsAgo > 1) {
      const goodwill = await Payment.query()
        .where('organization_id', organization.id)
        .orderBy('occurred_at', 'asc')
        .firstOrFail()

      goodwill.refundedAmountCents = Math.round(plan.priceCents / 2)
      goodwill.status = 'partially_refunded'
      goodwill.description = `${plan.name} plan — monthly (partly refunded)`
      await goodwill.save()
    }

    return { organization, user }
  }

  /**
   * Forty ordinary paying customers, each renewing on its own day, and the
   * free sign-ups around them.
   *
   * The tour workspaces all bill on the first of the month, which is right
   * for them and useless for the volume chart (plan §12): thirty days of
   * history with money on one of them is a spike, not a line. Monthly
   * billing puts one charge per customer in any fortnight, so filling
   * fourteen days in a row takes at least fourteen customers — there is no
   * honest way to do it with fewer.
   *
   * They are backdated across the year like everything else, so they also
   * give the growth chart and the plan mix something to show. Three of the
   * latest charges were refunded, in part or in full, so *refunded* is a
   * line with a shape and net visibly parts from gross.
   *
   * The strip under that chart counts registrations and cancellations per
   * day, so each of them registered the day of its first charge, seven have
   * cancelled at some point in the quarter, and twenty-eight free workspaces
   * registered without paying at all.
   *
   * Sixteen are written out by hand and cover the last fortnight; the rest
   * are generated to fill the other days of the month, which with everyone's
   * earlier renewals puts money on every day of the 90-day range.
   *
   * Returns how many workspaces that was and how many distinct days of the
   * month they bill on, for the summary.
   */
  private async seedBillingCohort(): Promise<{ workspaces: number; billedDays: number }> {
    const { DateTime } = await import('luxon')
    const { default: Payment } = await import('#models/payment')
    const { default: Subscription } = await import('#models/subscription')
    const { default: registration } = await import('#auth/registration_service')

    const today = DateTime.utc().startOf('day')

    const customers: {
      name: string
      owner: string
      plan: 'pro' | 'business'
      monthsAgo: number
      billedDaysAgo: number
      refundedShare?: number

      /** Signed up the day of that first charge, rather than months ago. */
      newCustomer?: boolean

      /** Cancelled this many days ago, and back on Free since. */
      cancelledDaysAgo?: number
    }[] = [
      {
        name: 'Fabrikam Studio',
        owner: 'Priya Raman',
        plan: 'pro',
        monthsAgo: 2,
        billedDaysAgo: 0,
        newCustomer: true,
      },
      {
        name: 'Tailspin Labs',
        owner: 'Owen Gallagher',
        plan: 'business',
        monthsAgo: 5,
        billedDaysAgo: 1,
      },
      {
        name: 'Wingtip Outdoor',
        owner: 'Noor Haddad',
        plan: 'pro',
        monthsAgo: 9,
        billedDaysAgo: 2,
        newCustomer: true,
      },
      {
        name: 'Adatum Logistics',
        owner: 'Tomasz Nowak',
        plan: 'pro',
        monthsAgo: 3,
        billedDaysAgo: 3,
        refundedShare: 1,
      },
      {
        name: 'Lakeshore Clinic',
        owner: 'Grace Achieng',
        plan: 'business',
        monthsAgo: 11,
        billedDaysAgo: 4,
      },
      { name: 'Proseware', owner: 'Diego Fuentes', plan: 'pro', monthsAgo: 1, billedDaysAgo: 5 },
      {
        name: 'Blue Yonder Travel',
        owner: 'Mei Tanaka',
        plan: 'pro',
        monthsAgo: 6,
        billedDaysAgo: 6,
        newCustomer: true,
      },
      {
        name: 'Woodgrove Finance',
        owner: 'Arjun Mehta',
        plan: 'business',
        monthsAgo: 8,
        billedDaysAgo: 7,
        refundedShare: 0.25,
      },
      {
        name: 'Litware Press',
        owner: 'Sofia Lindqvist',
        plan: 'pro',
        monthsAgo: 4,
        billedDaysAgo: 8,
        newCustomer: true,
      },
      { name: 'Coho Vineyard', owner: 'Emeka Obi', plan: 'pro', monthsAgo: 10, billedDaysAgo: 9 },
      {
        name: 'Alpine Ski House',
        owner: 'Clara Weiss',
        plan: 'business',
        monthsAgo: 2,
        billedDaysAgo: 10,
        newCustomer: true,
        cancelledDaysAgo: 5,
      },
      {
        name: 'Margie Travel',
        owner: 'Yusuf Demir',
        plan: 'pro',
        monthsAgo: 7,
        billedDaysAgo: 11,
        refundedShare: 0.5,
        cancelledDaysAgo: 9,
      },
      {
        name: 'Trey Research',
        owner: 'Hana Kobayashi',
        plan: 'pro',
        monthsAgo: 3,
        billedDaysAgo: 12,
        newCustomer: true,
      },
      {
        name: 'Humongous Insurance',
        owner: 'Ruth Okonkwo',
        plan: 'business',
        monthsAgo: 12,
        billedDaysAgo: 13,
      },
      {
        name: 'Southridge Video',
        owner: 'Mateo Rossi',
        plan: 'pro',
        monthsAgo: 5,
        billedDaysAgo: 15,
        cancelledDaysAgo: 2,
      },
      {
        name: 'Graphic Design Institute',
        owner: 'Ingrid Solberg',
        plan: 'pro',
        monthsAgo: 1,
        billedDaysAgo: 17,
        newCustomer: true,
      },
    ]

    /**
     * The sixteen above cover the last fortnight by hand. These fill in the
     * rest of the month — billing days 14 to 29 — so that with every
     * customer's earlier renewals behind them, there is a charge on every day
     * of the 90-day range, not only on the days somebody thought to write
     * down.
     *
     * Generated, but not random: the same names on the same days every time,
     * so a screenshot taken today matches one taken after the next re-seed.
     */
    const places = [
      'Northgate',
      'Bluebird',
      'Cedar',
      'Ironwood',
      'Kestrel',
      'Marlow',
      'Pinecrest',
      'Quillon',
      'Redfern',
      'Saffron',
      'Tidewater',
      'Umber',
      'Vantage',
      'Willowbrook',
      'Yarrow',
      'Zephyr',
      'Ashdown',
      'Brightwater',
      'Copperfield',
      'Dunmore',
      'Elmhurst',
      'Foxglove',
      'Greywell',
      'Hollis',
    ]
    const trades = ['Studio', 'Labs', 'Supply', 'Works', 'Partners', 'Collective', 'Foods', 'Media']
    const firstNames = [
      'Amara',
      'Bjorn',
      'Chidi',
      'Dalia',
      'Elias',
      'Freya',
      'Goran',
      'Hyun',
      'Imani',
      'Jonas',
      'Kavya',
      'Liam',
      'Mina',
      'Nikolai',
      'Oksana',
      'Paolo',
      'Qiang',
      'Rosa',
      'Samir',
      'Tessa',
      'Ulla',
      'Viktor',
      'Wanjiru',
      'Xavier',
    ]
    const lastNames = [
      'Adeyemi',
      'Bianchi',
      'Castillo',
      'Dubois',
      'Eriksen',
      'Farouk',
      'Georgiou',
      'Horvat',
      'Ivanova',
      'Jensen',
      'Khan',
      'Laurent',
      'Mwangi',
      'Novak',
      'Ortega',
      'Petrov',
      'Quinn',
      'Reyes',
      'Sato',
      'Thapa',
      'Unger',
      'Varga',
      'Wongsakul',
      'Yilmaz',
    ]
    const personAt = (index: number) =>
      `${firstNames[index % firstNames.length]} ${lastNames[(index * 7 + 3) % lastNames.length]}`

    for (const [index, place] of places.entries()) {
      customers.push({
        name: `${place} ${trades[index % trades.length]}`,
        owner: personAt(index),
        plan: index % 4 === 1 ? 'business' : 'pro',
        monthsAgo: 1 + ((index * 5) % 12),
        billedDaysAgo: 14 + (index % 16),
        refundedShare: index % 9 === 4 ? 0.5 : undefined,
        /*
         * Four of them left, further back each time — churn across the
         * quarter. Only from days a second customer also bills on, so a
         * cancellation never leaves a hole in the month.
         */
        cancelledDaysAgo: index < 8 && index % 2 === 0 ? 12 + index * 10 : undefined,
      })
    }

    for (const customer of customers) {
      const slug = customer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

      const { organization, user } = await this.seedPaidWorkspace(
        customer.plan,
        customer.name,
        `owner-${slug}@example.com`,
        /* A new customer has exactly the one charge they signed up with. */
        customer.newCustomer ? 1 : customer.monthsAgo,
        customer.owner,
        customer.billedDaysAgo
      )

      /**
       * They registered the day of their first charge. `backdate()` puts a
       * workspace a whole number of months before *today*, which would stack
       * every one of these on the same day of the month — a registrations
       * chart with one bar in it.
       */
      const first = await Payment.query()
        .where('organization_id', organization.id)
        .orderBy('occurred_at', 'asc')
        .firstOrFail()

      organization.createdAt = first.occurredAt
      user.createdAt = first.occurredAt
      await user.save()

      if (customer.cancelledDaysAgo !== undefined) {
        const canceledAt = today.minus({ days: customer.cancelledDaysAgo })

        const subscription = await Subscription.findByOrFail('organization_id', organization.id)
        subscription.status = 'canceled'
        subscription.canceledAt = canceledAt
        await subscription.save()

        /* Nobody is charged after they leave. */
        const charges = await Payment.query().where('organization_id', organization.id)

        for (const charge of charges) {
          /*
           * Compared here rather than in SQL, like every other date in the
           * back-office: the two databases store a timestamp differently.
           */
          if (charge.occurredAt > canceledAt) {
            await charge.delete()
          }
        }

        organization.planKey = 'free'
      }

      await organization.save()

      if (customer.refundedShare) {
        const latest = await Payment.query()
          .where('organization_id', organization.id)
          .orderBy('occurred_at', 'desc')
          .firstOrFail()

        latest.refundedAmountCents = Math.round(latest.amountCents * customer.refundedShare)
        latest.status = customer.refundedShare === 1 ? 'refunded' : 'partially_refunded'
        await latest.save()
      }
    }

    /**
     * And the people who signed up and have not paid for anything, because
     * most registrations are exactly that. Without them the chart would say
     * every sign-up converts on day one.
     */
    const signups: [name: string, owner: string, daysAgo: number][] = [
      ['Harbor Bakery', 'Leila Nasser', 1],
      ['Fourth Coffee', 'Ben Whitaker', 1],
      ['Nod Publishers', 'Aiko Mori', 3],
      ['Lucerne Books', 'Pedro Alves', 6],
      ['School of Fine Art', 'Zofia Kaminska', 7],
      ['Relecloud', 'Farid Rahimi', 11],
    ]

    /* The same again for the rest of the quarter, thinning out as it goes back. */
    const earlier = [
      2, 4, 5, 9, 13, 15, 18, 20, 24, 26, 29, 33, 36, 40, 44, 47, 52, 57, 63, 70, 77, 84,
    ]

    earlier.forEach((daysAgo, index) => {
      signups.push([
        `${places[(index + 7) % places.length]} ${trades[(index + 3) % trades.length]}`,
        personAt(index + places.length),
        daysAgo,
      ])
    })

    for (const [name, owner, daysAgo] of signups) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const joined = today.minus({ days: daysAgo })

      const { user, organization } = await registration.register({
        fullName: owner,
        email: `owner-${slug}@example.com`,
        password: 'Example12345',
        organizationName: name,
      })

      user.emailVerifiedAt = joined
      user.createdAt = joined
      await user.save()

      organization.createdAt = joined
      await organization.save()
    }

    return {
      workspaces: customers.length + signups.length,
      billedDays: new Set(customers.map((customer) => customer.billedDaysAgo)).size,
    }
  }

  /**
   * The workspace the demo is toured in. Five lists, todos in every state a
   * todo has — overdue, due soon, assigned, done — a second and third pair of
   * hands, two API keys with traffic behind them, and some files.
   */
  private async seedProWorkspace(organization: Organization, owner: User) {
    const { DateTime } = await import('luxon')
    const { default: invitations } = await import('#organizations/invitation_service')

    const joining = await invitations.invite({
      organization,
      invitedBy: owner,
      email: 'dev@prowidgets.example',
    })
    await invitations.accept({
      token: joining.token,
      fullName: 'Priya Raghavan',
      password: 'Example12345',
    })

    const second = await invitations.invite({
      organization,
      invitedBy: owner,
      email: 'design@prowidgets.example',
    })
    await invitations.accept({
      token: second.token,
      fullName: 'Tomas Ferreira',
      password: 'Example12345',
    })

    await invitations.invite({
      organization,
      invitedBy: owner,
      email: 'ops@prowidgets.example',
    })

    const { default: UserModel } = await import('#models/user')
    const priya = await UserModel.findByOrFail('email', 'dev@prowidgets.example')
    const tomas = await UserModel.findByOrFail('email', 'design@prowidgets.example')

    /*
     * A team where nobody has ever signed in reads as a team nobody uses.
     * One of them genuinely has not, because that is also a real row.
     */
    priya.lastLoginAt = DateTime.utc().minus({ hours: 3 })
    await priya.save()

    tomas.lastLoginAt = DateTime.utc().minus({ days: 2 })
    await tomas.save()

    /*
     * The owner has been reading along: only what was published since their
     * last look carries the "new" flag, which is the whole feature (plan
     * §20.5). Acme's member is left unread, so the bell keeps its dot.
     */
    owner.notificationsSeenAt = DateTime.utc().minus({ days: 2 })
    await owner.save()

    /*
     * Two-factor, on. Optional for customers and mandatory for staff, so the
     * security screen has both states to show across the demo accounts —
     * and in development `DEV_TWO_FACTOR_CODE` signs this account in without
     * an authenticator app.
     */
    const { default: twoFactor } = await import('#auth/two_factor_service')
    const { generate } = await import('otplib')
    const { secret } = await twoFactor.beginEnrolment(owner)
    await twoFactor.confirmEnrolment(owner, await generate({ secret }))

    await this.seedApiKeys(organization, owner)
    await this.seedFiles(organization, owner, priya)

    return [priya, tomas]
  }

  /**
   * Two keys and the traffic behind them: one live key a nightly job uses,
   * one test key with nothing much, and fourteen days of usage so the chart
   * on the API screen has a shape (plan §13.5).
   */
  private async seedApiKeys(organization: Organization, owner: User) {
    const { DateTime } = await import('luxon')
    const { default: apiKeys } = await import('#api/api_key_service')
    const { default: ApiRequest } = await import('#models/api_request')
    const { default: ApiUsageDay } = await import('#models/api_usage_day')

    const nightly = await apiKeys.create(organization, owner, {
      name: 'Nightly sync',
      scopes: ['lists:read', 'lists:write', 'todos:read', 'todos:write'],
      environment: 'live',
    })

    await apiKeys.create(organization, owner, {
      name: 'Staging import',
      scopes: ['lists:read', 'todos:read'],
      environment: 'test',
    })

    /**
     * Rolled-up days for everything before today, raw requests for today —
     * the two sources the usage screen reads, and it reads them differently
     * (see ApiUsageService).
     */
    for (let back = 13; back >= 1; back--) {
      const day = DateTime.utc().minus({ days: back })
      const requests = 40 + ((back * 37) % 55)

      await ApiUsageDay.create({
        organizationId: organization.id,
        day: day.toFormat('yyyy-MM-dd'),
        requests,
        /* One bad afternoon, so the chart has a red bar to explain. */
        errors: back === 4 ? 9 : back === 11 ? 2 : 0,
      })
    }

    for (let index = 0; index < 26; index++) {
      await ApiRequest.create({
        organizationId: organization.id,
        apiKeyId: nightly.apiKey.id,
        requestId: `req_seed_${index.toString().padStart(3, '0')}`,
        method: index % 6 === 0 ? 'POST' : 'GET',
        path: index % 6 === 0 ? '/api/v1/lists' : '/api/v1/lists/lst_seed/todos',
        status: index === 11 ? 404 : 200,
        durationMs: 25 + ((index * 13) % 90),
        ip: '203.0.113.7',
      })
    }

    nightly.apiKey.lastUsedAt = DateTime.utc().minus({ hours: 3 })
    await nightly.apiKey.save()
  }

  /**
   * A few files, uploaded the way the application uploads them — through
   * `FileService`, so the checksum, the sniffed type and the storage quota
   * are all real.
   */
  private async seedFiles(organization: Organization, owner: User, member: User) {
    const { writeFile, mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { default: files } = await import('#storage/file_service')

    const directory = await mkdtemp(join(tmpdir(), 'dev-seed-'))

    const fixtures: { name: string; bytes: Buffer; actor: User }[] = [
      {
        name: 'launch-plan.pdf',
        bytes: Buffer.concat([Buffer.from('%PDF-1.7\n', 'ascii'), Buffer.alloc(24_000, 0x20)]),
        actor: owner,
      },
      {
        name: 'signups-by-week.csv',
        bytes: Buffer.from(
          `week,signups\n${Array.from(
            { length: 220 },
            (_, index) => `2026-W${String(index % 52).padStart(2, '0')},${12 + (index % 30)}`
          ).join('\n')}\n`,
          'utf8'
        ),
        actor: member,
      },
      {
        name: 'hero-shot.png',
        bytes: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(180_000, 0x11),
        ]),
        actor: owner,
      },
    ]

    for (const fixture of fixtures) {
      const tmpPath = join(directory, fixture.name)
      await writeFile(tmpPath, fixture.bytes)

      await files.upload(organization, fixture.actor, {
        tmpPath,
        clientName: fixture.name,
        sizeBytes: fixture.bytes.length,
      })
    }
  }

  /**
   * A workspace whose last charge failed. Everything still works — that is
   * the point of the banner it now carries (plan §7.5) — and it is the first
   * row in the back-office's "needs attention".
   */
  private async seedPastDueWorkspace() {
    const { DateTime } = await import('luxon')
    const { default: Payment } = await import('#models/payment')
    const { default: Subscription } = await import('#models/subscription')
    const { planFor } = await import('#config/plans')

    const { organization, user } = await this.seedPaidWorkspace(
      'pro',
      'Northwind Traders',
      'owner-northwind@example.com',
      3,
      'Hannah Bergstrom'
    )

    organization.status = 'past_due'
    await organization.save()

    const subscription = await Subscription.findByOrFail('organization_id', organization.id)
    subscription.status = 'past_due'
    await subscription.save()

    await Payment.create({
      organizationId: organization.id,
      subscriptionId: subscription.id,
      provider: 'creem',
      providerOrderId: 'ord_seed_northwind_failed',
      amountCents: planFor('pro').priceCents,
      currency: 'USD',
      status: 'disputed',
      refundedAmountCents: 0,
      description: 'Pro plan — monthly (card declined)',
      occurredAt: DateTime.utc().minus({ days: 4 }),
    })

    void user
  }

  /**
   * A workspace that left last month: the subscription is cancelled and the
   * plan is back to Free. Without one of these, churn is always zero and the
   * number on the dashboard cannot be trusted to move.
   */
  private async seedChurnedWorkspace() {
    const { DateTime } = await import('luxon')
    const { default: Subscription } = await import('#models/subscription')

    const { organization } = await this.seedPaidWorkspace(
      'pro',
      'Contoso Design',
      'owner-contoso@example.com',
      6,
      'Lucia Moretti'
    )

    const subscription = await Subscription.findByOrFail('organization_id', organization.id)
    subscription.status = 'canceled'
    subscription.canceledAt = DateTime.utc().minus({ days: 12 })
    await subscription.save()

    organization.planKey = 'free'
    await organization.save()
  }

  /**
   * Three announcements, because the feed's job is to be read in order and
   * one entry does not show that (plan §20).
   */
  private async seedAnnouncements() {
    const { DateTime } = await import('luxon')
    const { default: StaffUser } = await import('#models/staff_user')
    const { default: notifications } = await import('#notifications/notification_service')

    const staff = await StaffUser.findBy('email', 'admin@example.com')
    if (!staff) {
      return
    }

    const older = await notifications.create(staff, {
      title: 'Scheduled maintenance on Sunday',
      body: 'The API will be read-only between 02:00 and 03:00 UTC while we move the database.',
      level: 'warning',
      audienceType: 'all',
    })
    older.publishedAt = DateTime.utc().minus({ days: 9 })
    await older.save()

    const middle = await notifications.create(staff, {
      title: 'Two-factor authentication is available',
      body: 'Turn it on under Settings → Security. Staff accounts already require it.',
      level: 'success',
      audienceType: 'all',
    })
    middle.publishedAt = DateTime.utc().minus({ days: 3 })
    await middle.save()

    await notifications.create(staff, {
      title: 'Bigger limits on Pro',
      body: 'Pro now includes 25 lists and 10 seats, at the same price. Nothing to do — your workspace already has them.',
      level: 'info',
      audienceType: 'plan',
      audience: { planKeys: ['pro'] },
      actionLabel: 'See plans',
      actionUrl: 'https://example.com/pricing',
    })
  }

  /**
   * Three conversations, one in each state (plan §21.2), so the queue, the
   * badges and the two-pane layout all have something to show. The one
   * waiting on the customer is what puts a count beside *Support* in the
   * account menu.
   */
  private async seedSupportTickets() {
    const { DateTime } = await import('luxon')
    const { default: StaffUser } = await import('#models/staff_user')
    const { default: UserModel } = await import('#models/user')
    const { default: Organization } = await import('#models/organization')
    const { default: support } = await import('#support/support_service')

    const staff = await StaffUser.findBy('email', 'support@example.com')
    const jane = await UserModel.findBy('email', 'jane@example.com')
    const pro = await Organization.findBy('slug', 'pro-widgets')
    const proOwner = await UserModel.findBy('email', 'owner-pro@example.com')

    if (!staff || !jane || !pro || !proOwner) {
      return
    }

    const acme = await Organization.findOrFail(jane.organizationId)

    /* Waiting on us: nobody has answered it yet. */
    const waiting = await support.open(acme, jane, {
      subject: 'Uploads over 10 MB time out',
      body: 'Every file above ten megabytes stops at 90% and then fails. This is on a 40 Mbit connection, and smaller files are fine.',
    })
    waiting.ticket.createdAt = DateTime.utc().minus({ hours: 5 })
    waiting.ticket.lastMessageAt = DateTime.utc().minus({ hours: 5 })
    await waiting.ticket.save()

    /* Waiting on them: answered, and the count in the account menu. */
    const answered = await support.open(pro, proOwner, {
      subject: 'Can we get a second API key for staging?',
      body: 'We would rather not point the staging import at the live key.',
    })
    await support.replyAsStaff(
      answered.ticket,
      staff,
      'You can — the Pro plan allows five keys. Settings → API Keys → New key, and pick the test environment so the prefix says which is which.'
    )

    /* Resolved: done, until somebody replies to it. */
    const resolved = await support.open(pro, proOwner, {
      subject: 'Invoice address is wrong',
      body: 'Our billing address changed last month.',
    })
    await support.replyAsStaff(
      resolved.ticket,
      staff,
      'Updated on the subscription — the next invoice will carry the new address.'
    )
    await support.resolve(resolved.ticket)
    resolved.ticket.createdAt = DateTime.utc().minus({ days: 9 })
    await resolved.ticket.save()
  }

  /**
   * The two rows the operations screens exist for. Neither is alarming on its
   * own; both are invisible until something reads them, which is why the
   * dashboard leads with them (plan §12).
   */
  private async seedOperations() {
    const { DateTime } = await import('luxon')
    const { default: Job } = await import('#models/job')
    const { default: WebhookEvent } = await import('#models/webhook_event')

    await Job.create({
      queue: 'default',
      name: 'SendMailJob',
      payload: { to: 'owner-northwind@example.com', mail: 'PaymentFailedNotification' },
      attempts: 3,
      maxAttempts: 3,
      availableAt: DateTime.utc().minus({ hours: 6 }),
      failedAt: DateTime.utc().minus({ hours: 5 }),
      lastError: 'Error: connect ECONNREFUSED 127.0.0.1:1025',
    })

    await WebhookEvent.create({
      provider: 'creem',
      providerEventId: 'evt_seed_unapplied',
      eventType: 'subscription.updated',
      payload: { id: 'sub_seed_pro', status: 'active' },
      signatureVerified: true,
      attempts: 1,
      lastError: 'Unknown subscription: sub_not_in_this_database',
      receivedAt: DateTime.utc().minus({ hours: 2 }),
    })
  }

  /* ---------------------------------------------------------------------- */
}
