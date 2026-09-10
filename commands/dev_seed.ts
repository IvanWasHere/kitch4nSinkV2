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

    await this.backdate(organization, user, 7)

    /**
     * A staff override on todos as well as seats (plan §7.4). Twelve is small
     * enough that a list can be *seen* filling up — the count pill turning
     * amber and then red is the whole point of the meter, and it is invisible
     * against the plan's own 50.
     */
    organization.limitOverrides = { seats: 5, todosPerList: 12 }
    await organization.save()

    const { default: UserModel } = await import('#models/user')
    const member = await UserModel.findByOrFail('email', 'sam@example.com')
    await this.seedAcmeLists(organization, user, member)

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
    await this.seedProWorkspace(pro.organization, pro.user)

    /**
     * The two states nobody sets up by hand and every support screen is
     * built for.
     */
    await this.seedPastDueWorkspace()
    await this.seedChurnedWorkspace()

    await this.seedAnnouncements()
    await this.seedSupportTickets()
    await this.seedOperations()

    this.logger.success('Seeded Acme (free)')
    this.logger.log('  owner:   jane@example.com / correct-horse-battery')
    this.logger.log('  member:  sam@example.com / correct-horse-battery')
    this.logger.log('  invited: alex@example.com (pending)')
    this.logger.log('')
    this.logger.success('Seeded paid tiers')
    this.logger.log('  pro:      owner-pro@example.com / correct-horse-battery')
    this.logger.log('  business: owner-business@example.com / correct-horse-battery')
    this.logger.log('')
    this.logger.success('Seeded the states support screens exist for')
    this.logger.log('  past due:  owner-northwind@example.com (dunning banner, needs attention)')
    this.logger.log('  cancelled: owner-contoso@example.com (churn)')
    this.logger.log('  plus 3 announcements, 3 support tickets, a stuck webhook and a failed job')
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
    ownerName = 'Alex Chen'
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
      password: 'correct-horse-battery',
      organizationName: name,
    })

    user.emailVerifiedAt = DateTime.utc()
    await user.save()

    organization.planKey = planKey
    await organization.save()

    await this.backdate(organization, user, monthsAgo)

    const periodStart = DateTime.utc().startOf('month')

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
   * Acme's lists, sized against the overridden todo cap so the meters have
   * something to say: one comfortable, one amber, one full. A full list is
   * not a broken one — everything in it still works, only *adding* is blocked
   * (plan §7.4) — and that is hard to believe until you see it.
   */
  private async seedAcmeLists(organization: Organization, owner: User, member: User) {
    const { DateTime } = await import('luxon')

    /*
     * The filler goes in first so it is the *oldest* work here. The dashboard
     * lists the newest todos, and a column of "Client request 11" tells
     * whoever opens it nothing at all.
     */
    const punch = await this.list(organization, owner, {
      name: 'Launch punch list',
      description: 'Everything between here and the announcement.',
      color: 'orange',
    })

    await this.fill(organization, punch, owner, 11, 'Punch list item')

    const requests = await this.list(organization, owner, {
      name: 'Client requests',
      description: 'Full — the plan allows twelve here, and there are twelve.',
      color: 'red',
    })

    await this.fill(organization, requests, member, 12, 'Client request')

    const weekly = await this.list(organization, owner, {
      name: 'Weekly ops',
      description: 'The recurring run — someone ticks these off every Monday.',
      color: 'blue',
    })

    await this.todo(organization, weekly, owner, {
      title: 'Check the queue for anything stuck overnight',
      priority: 'high',
      dueAt: DateTime.utc().plus({ days: 1 }),
      assignee: member,
    })
    await this.todo(organization, weekly, owner, {
      title: 'Reply to anything sitting in support over a day',
      dueAt: DateTime.utc().plus({ days: 2 }),
    })
    await this.todo(organization, weekly, member, {
      title: 'Post the weekly numbers',
      notes: 'Signups, churn and anything that moved more than ten percent.',
    })
    await this.complete(organization, weekly, owner, 'Rotate the staging database')
  }

  /**
   * The workspace the demo is toured in. Five lists, todos in every state a
   * todo has — overdue, due soon, assigned, done — a second and third pair of
   * hands, two API keys with traffic behind them, and some files.
   */
  private async seedProWorkspace(organization: Organization, owner: User) {
    const { DateTime } = await import('luxon')
    const { default: invitations } = await import('#organizations/invitation_service')
    const { default: lists } = await import('#todos/list_service')

    const joining = await invitations.invite({
      organization,
      invitedBy: owner,
      email: 'dev@prowidgets.example',
    })
    await invitations.accept({
      token: joining.token,
      fullName: 'Priya Raghavan',
      password: 'correct-horse-battery',
    })

    const second = await invitations.invite({
      organization,
      invitedBy: owner,
      email: 'design@prowidgets.example',
    })
    await invitations.accept({
      token: second.token,
      fullName: 'Tomas Ferreira',
      password: 'correct-horse-battery',
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

    const launch = await this.list(organization, owner, {
      name: 'Launch checklist',
      description: 'Everything that has to be true before we tell anyone.',
      color: 'blue',
    })

    /* Overdue by two days: the dashboard counts it, and the row goes red. */
    await this.todo(organization, launch, owner, {
      title: 'Rotate the webhook signing secret',
      notes: 'The one in the provider dashboard, not the one in .env.',
      priority: 'high',
      dueAt: DateTime.utc().minus({ days: 2 }),
      assignee: priya,
    })
    await this.todo(organization, launch, owner, {
      title: 'Point the status page at the new host',
      priority: 'high',
      dueAt: DateTime.utc().plus({ days: 1 }),
      assignee: tomas,
    })
    await this.todo(organization, launch, owner, {
      title: 'Write the deployment guide',
      dueAt: DateTime.utc().plus({ days: 4 }),
    })
    await this.todo(organization, launch, priya, {
      title: 'Verify the sending domain',
      priority: 'low',
    })
    await this.complete(organization, launch, owner, 'Move the demo data off the live database')
    await this.complete(organization, launch, priya, 'Take a backup and restore it somewhere else')

    const triage = await this.list(organization, owner, {
      name: 'Bug triage',
      description: 'Reported this week, worst first.',
      color: 'red',
    })

    await this.todo(organization, triage, priya, {
      title: 'Uploads over 10 MB time out on slow connections',
      priority: 'high',
      dueAt: DateTime.utc().plus({ days: 2 }),
      assignee: priya,
    })
    await this.todo(organization, triage, tomas, {
      title: 'Invitation email renders wide in Outlook',
      priority: 'low',
      assignee: tomas,
    })
    await this.todo(organization, triage, owner, {
      title: 'Sorting by due date puts empty dates first',
    })
    await this.complete(organization, triage, priya, 'Two-factor codes rejected a second early')

    const calendar = await this.list(organization, owner, {
      name: 'Content calendar',
      description: 'What goes out, and when.',
      color: 'green',
    })

    await this.todo(organization, calendar, tomas, {
      title: 'Draft the launch post',
      dueAt: DateTime.utc().plus({ days: 6 }),
      assignee: tomas,
    })
    await this.todo(organization, calendar, tomas, {
      title: 'Three screenshots for the changelog',
      dueAt: DateTime.utc().plus({ days: 9 }),
    })

    const design = await this.list(organization, owner, {
      name: 'Design system',
      description: 'Tokens, components, and the things that disagree with them.',
      color: 'purple',
    })

    await this.todo(organization, design, tomas, {
      title: 'Audit the empty states',
      assignee: tomas,
    })
    await this.todo(organization, design, tomas, { title: 'One focus ring, everywhere' })

    /* Archived, not deleted: it still counts against the cap (plan §5.6). */
    const retro = await this.list(organization, owner, {
      name: 'Q2 retro actions',
      description: 'Closed out — kept so the next retro can read it.',
      color: 'gray',
    })
    await this.complete(organization, retro, owner, 'Write the incident review')
    await this.complete(organization, retro, priya, 'Alert on queue depth, not just failures')
    await lists.archive(retro)

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

  private async list(
    organization: Organization,
    actor: User,
    data: { name: string; description?: string; color?: string }
  ) {
    const { default: lists } = await import('#todos/list_service')

    return lists.create(organization, actor, data as never)
  }

  private async todo(
    organization: Organization,
    list: Awaited<ReturnType<DevSeed['list']>>,
    actor: User,
    data: {
      title: string
      notes?: string
      priority?: 'low' | 'normal' | 'high'
      dueAt?: import('luxon').DateTime
      assignee?: User
    }
  ) {
    const { default: todos } = await import('#todos/todo_service')

    return todos.create(organization, list, actor, {
      title: data.title,
      notes: data.notes ?? null,
      priority: data.priority ?? 'normal',
      dueAt: data.dueAt ?? null,
      assignedToPublicId: data.assignee?.publicId ?? null,
    })
  }

  /**
   * A todo that is already done, so "recently finished" is not an empty box
   * on a workspace that has clearly been working.
   */
  private async complete(
    organization: Organization,
    list: Awaited<ReturnType<DevSeed['list']>>,
    actor: User,
    title: string
  ) {
    const { default: todos } = await import('#todos/todo_service')

    const todo = await this.todo(organization, list, actor, { title })
    await todos.complete(todo, actor)

    return todo
  }

  /**
   * Filler, for a list whose point is how full it is rather than what is in
   * it. Numbered so nobody mistakes it for real work.
   */
  private async fill(
    organization: Organization,
    list: Awaited<ReturnType<DevSeed['list']>>,
    actor: User,
    count: number,
    prefix: string
  ) {
    for (let index = 1; index <= count; index++) {
      await this.todo(organization, list, actor, { title: `${prefix} ${index}` })
    }
  }
}
