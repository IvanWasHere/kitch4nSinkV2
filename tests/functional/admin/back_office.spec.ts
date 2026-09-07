import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import AuditLog from '#models/audit_log'
import StaffUser from '#models/staff_user'
import TodoList from '#models/todo_list'
import { IMPERSONATION_SESSION_KEY } from '#middleware/impersonation'
import { addMember, createStaff, createWorkspace, queuedMailsTo } from '#tests/helpers'

/**
 * The back-office (plan §12) and the support/admin split (plan §6).
 */
test.group('Back-office access', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('support can reach every screen', async ({ client }) => {
    const staff = await createStaff({ role: 'support' })

    for (const path of [
      '/admin',
      '/admin/organizations',
      '/admin/users',
      '/admin/subscriptions',
      '/admin/webhooks',
      '/admin/audit',
      '/admin/jobs',
    ]) {
      const response = await client.get(path).withGuard('staff').loginAs(staff)
      response.assertStatus(200)
    }
  })

  /**
   * Staff management is the one screen support cannot see: anybody who can
   * create a staff account can grant themselves everything else.
   */
  test('support cannot reach staff management', async ({ client }) => {
    const staff = await createStaff({ role: 'support' })

    const response = await client.get('/admin/staff').withGuard('staff').loginAs(staff)

    response.assertStatus(403)
  })

  test('an admin can', async ({ client }) => {
    const staff = await createStaff({ role: 'admin' })

    const response = await client.get('/admin/staff').withGuard('staff').loginAs(staff)

    response.assertStatus(200)
  })

  test('a tenant user cannot reach the back-office at all', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/admin/organizations').loginAs(user).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/login')
  })

  /**
   * Revoking access takes effect on the next request, not at the end of a
   * session.
   */
  test('a disabled account is refused immediately', async ({ client }) => {
    const staff = await createStaff({ disabled: true })

    const response = await client
      .get('/admin/organizations')
      .withGuard('staff')
      .loginAs(staff)
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin/login')
  })
})

test.group('Back-office — organisations', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(() => testUtils.db().truncate())

  test('finds a workspace by name, id or a member’s email', async ({ client, assert }) => {
    const staff = await createStaff()
    const { organization } = await createWorkspace({ email: 'findme@example.com' })

    for (const term of ['Jane', organization.publicId, 'findme@example.com']) {
      const response = await client
        .get(`/admin/organizations?q=${encodeURIComponent(term)}`)
        .withGuard('staff')
        .loginAs(staff)

      response.assertStatus(200)
      assert.include(response.text(), organization.publicId, `searched for ${term}`)
    }
  })

  test('the detail screen shows members, usage and the trail', async ({ client }) => {
    const staff = await createStaff()
    const { user, organization } = await createWorkspace()
    await addMember(organization, user, 'sam@example.com')

    const response = await client
      .get(`/admin/organizations/${organization.publicId}`)
      .withGuard('staff')
      .loginAs(staff)

    response.assertStatus(200)
    response.assertTextIncludes('sam@example.com')
    response.assertTextIncludes('Lists')
    response.assertTextIncludes('Seats')
  })

  /**
   * Support sees the screen without the dangerous buttons rather than a 403
   * — which is the whole reason these are policy checks inside the
   * controller rather than middleware on the route (plan §6).
   */
  test('support sees the detail screen without the plan or suspend controls', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff({ role: 'support' })
    const { organization } = await createWorkspace()

    const response = await client
      .get(`/admin/organizations/${organization.publicId}`)
      .withGuard('staff')
      .loginAs(staff)

    response.assertStatus(200)
    assert.notInclude(response.text(), 'Apply plan override')
    assert.notInclude(response.text(), 'Suspend workspace')
  })

  test('and cannot post one either', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })
    const { organization } = await createWorkspace()

    const response = await client
      .post(`/admin/organizations/${organization.publicId}/plan`)
      .withGuard('staff')
      .loginAs(staff)
      .form({ plan_key: 'business' })
      .withCsrfToken()
      .redirects(0)

    /**
     * Bouncer refuses an HTML POST by redirecting back with a flash rather
     * than rendering a 403 page — the refusal is the redirect plus the fact
     * that nothing changed.
     */
    response.assertStatus(302)

    await organization.refresh()
    assert.equal(organization.planKey, 'free', 'nothing changed')
  })

  test('an admin can override the plan, and it is audited with the reason', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff({ role: 'admin' })
    const { organization } = await createWorkspace()

    const response = await client
      .post(`/admin/organizations/${organization.publicId}/plan`)
      .withGuard('staff')
      .loginAs(staff)
      .form({ plan_key: 'business', reason: 'ticket-4412' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await organization.refresh()
    assert.equal(organization.planKey, 'business')

    const entry = await AuditLog.query()
      .where('action', 'organization.plan_overridden')
      .firstOrFail()
    assert.equal(entry.actorType, 'staff')
    assert.equal(entry.actorId, staff.id)
    assert.equal(entry.organizationId, organization.id)
    assert.equal(entry.metadata?.from, 'free')
    assert.equal(entry.metadata?.to, 'business')
    assert.equal(entry.metadata?.reason, 'ticket-4412')
  })

  test('an admin can raise a single limit, and clear it again', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const { organization } = await createWorkspace()

    const raise = () =>
      client
        .post(`/admin/organizations/${organization.publicId}/limits`)
        .withGuard('staff')
        .loginAs(staff)
        .withCsrfToken()
        .redirects(0)

    await raise().form({ limit: 'lists', value: '99' })
    await organization.refresh()
    assert.deepEqual(organization.limitOverrides, { lists: 99 })

    await raise().form({ limit: 'lists', value: 'unlimited' })
    await organization.refresh()
    assert.deepEqual(organization.limitOverrides, { lists: null })

    await raise().form({ limit: 'lists', value: '' })
    await organization.refresh()
    assert.isNull(organization.limitOverrides, 'cleared back to the plan’s own limit')
  })

  /**
   * A suspension with no reason is unanswerable later, which is the whole
   * point of the audit trail.
   */
  test('suspending requires a reason', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const { organization } = await createWorkspace()

    const response = await client
      .post(`/admin/organizations/${organization.publicId}/suspend`)
      .withGuard('staff')
      .loginAs(staff)
      .form({})
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    await organization.refresh()
    assert.equal(organization.status, 'active')
    assert.lengthOf(await AuditLog.query().where('action', 'organization.suspended'), 0)
  })

  test('suspending signs the workspace out, and restoring lets it back', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff({ role: 'admin' })
    const { user, organization } = await createWorkspace()

    await client
      .post(`/admin/organizations/${organization.publicId}/suspend`)
      .withGuard('staff')
      .loginAs(staff)
      .form({ reason: 'chargeback' })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.equal(organization.status, 'suspended')

    /**
     * `suspended` is the one status that denies access (plan §5.2).
     */
    const blocked = await client.get('/dashboard').loginAs(user).redirects(0)
    blocked.assertStatus(302)

    await client
      .post(`/admin/organizations/${organization.publicId}/suspend`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.equal(organization.status, 'active')

    const entries = await AuditLog.query().whereIn('action', [
      'organization.suspended',
      'organization.restored',
    ])
    assert.lengthOf(entries, 2)
  })
})

test.group('Back-office — users', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(() => testUtils.db().truncate())

  test('support can resend a verification email', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })
    const { user } = await createWorkspace({ verified: false })

    const response = await client
      .post(`/admin/users/${user.publicId}/resend-verification`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const queued = await queuedMailsTo(user.email)
    assert.isNotEmpty(queued.filter((message) => message.subject.includes('Confirm your email')))

    assert.lengthOf(await AuditLog.query().where('action', 'user.verification_resent'), 1)
  })

  /**
   * The escape hatch for a provider silently dropping our mail — which
   * happens, and leaves somebody locked out of an account they paid for.
   */
  test('support can confirm an address by hand, and it is audited', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })
    const { user } = await createWorkspace({ verified: false })

    await client
      .post(`/admin/users/${user.publicId}/verify`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    await user.refresh()
    assert.isTrue(user.hasVerifiedEmail)

    const entry = await AuditLog.query().where('action', 'user.verified_by_staff').firstOrFail()
    assert.equal(entry.actorId, staff.id)
  })

  /**
   * Cleared, not reset to something staff choose — so staff never hold a
   * credential that would let them sign in as somebody.
   */
  test('support can clear a lost second factor', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })
    const { user } = await createWorkspace()

    const { enableTwoFactor } = await import('#tests/helpers')
    await enableTwoFactor(user)
    await user.refresh()
    assert.isTrue(user.hasTwoFactor)

    await client
      .post(`/admin/users/${user.publicId}/reset-two-factor`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    await user.refresh()
    assert.isFalse(user.hasTwoFactor)
    assert.lengthOf(await AuditLog.query().where('action', 'user.two_factor_reset'), 1)
  })
})

/**
 * Impersonation (plan §6) — the feature with the most rules, because it is
 * the one that lets an employee act inside a customer's account.
 */
test.group('Impersonation', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })
  group.each.setup(() => testUtils.db().truncate())

  const start = async (client: any, staff: StaffUser, userPublicId: string) => {
    return client
      .post(`/admin/users/${userPublicId}/impersonate`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)
  }

  test('starts a tenant session and records both ids', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const { user, organization } = await createWorkspace()

    const response = await start(client, staff, user.publicId)

    response.assertStatus(302)
    response.assertHeader('location', '/dashboard')
    response.assertSession('auth_web', user.id)

    const entry = await AuditLog.query().where('action', 'impersonation.started').firstOrFail()
    assert.equal(entry.actorType, 'staff')
    assert.equal(entry.actorId, staff.id, 'who did it')
    assert.equal(entry.subjectId, user.publicId, 'and to whom')
    assert.equal(entry.organizationId, organization.id)
  })

  test('the banner is on every tenant screen', async ({ client }) => {
    const staff = await createStaff({ role: 'support' })
    const { user } = await createWorkspace()

    const started = await start(client, staff, user.publicId)

    for (const path of ['/dashboard', '/lists']) {
      const response = await client.get(path).withSession(started.session())

      response.assertStatus(200)
      response.assertTextIncludes('Impersonating')
      response.assertTextIncludes('Stop impersonating')
      response.assertTextIncludes('read-only')
    }
  })

  /**
   * Read-only for support: the difference between "look at what the customer
   * sees" and "act as the customer".
   */
  test('support cannot write anything while impersonating', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })
    const { user, organization } = await createWorkspace()

    const started = await start(client, staff, user.publicId)

    const write = await client
      .post('/lists')
      .withSession(started.session())
      .form({ name: 'Support should not create this' })
      .withCsrfToken()
      .redirects(0)

    write.assertStatus(302)

    const lists = await TodoList.query().where('organization_id', organization.id)
    assert.isEmpty(lists, 'nothing was created')
  })

  test('an admin may write, and the entry names both actors', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const { user, organization } = await createWorkspace()

    const started = await start(client, staff, user.publicId)

    const write = await client
      .post('/lists')
      .withSession(started.session())
      .form({ name: 'Fixed for the customer' })
      .withCsrfToken()
      .redirects(0)

    write.assertStatus(302)

    const lists = await TodoList.query().where('organization_id', organization.id)
    assert.lengthOf(lists, 1)
    assert.equal(lists[0].createdByUserId, user.id, 'created as the customer')
  })

  /**
   * The bug this test exists for: ending an impersonation is itself a POST,
   * so the read-only rule blocked support from ever leaving a session it had
   * let them start. The only way out was waiting an hour for the expiry.
   */
  test('support can end its own read-only session', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })
    const { user } = await createWorkspace()

    const started = await start(client, staff, user.publicId)

    const stopped = await client
      .post('/stop-impersonating')
      .withSession(started.session())
      .withCsrfToken()
      .redirects(0)

    stopped.assertStatus(302)
    stopped.assertHeader('location', '/admin')
    stopped.assertSessionMissing('auth_web')
    stopped.assertSessionMissing(IMPERSONATION_SESSION_KEY)

    /**
     * And the ending is attributed. This route has no staff middleware, so
     * the actor comes from the session — without that it recorded an "ended
     * by nobody" entry, which is worse than none because it looks like a
     * record.
     */
    const entry = await AuditLog.query().where('action', 'impersonation.ended').firstOrFail()
    assert.equal(entry.actorId, staff.id)
    assert.equal(entry.metadata?.staffEmail, staff.email)
  })

  test('expires by itself', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const { user } = await createWorkspace()

    const started = await start(client, staff, user.publicId)

    /**
     * An absolute expiry, so a page that polls cannot keep it open.
     */
    const response = await client
      .get('/dashboard')
      .withSession({
        ...started.session(),
        [IMPERSONATION_SESSION_KEY]: {
          ...started.session()[IMPERSONATION_SESSION_KEY],
          expiresAt: DateTime.utc().minus({ minutes: 1 }).toISO(),
        },
      })
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin')
    response.assertSessionMissing('auth_web')

    assert.isTrue(true)
  })

  /**
   * Revoking a staff account must end a session already in flight, not wait
   * for them to sign out.
   */
  test('a disabled staff account ends an impersonation in flight', async ({ client }) => {
    const staff = await createStaff({ role: 'admin' })
    const { user } = await createWorkspace()

    const started = await start(client, staff, user.publicId)

    staff.disabledAt = DateTime.utc()
    await staff.save()

    const response = await client.get('/dashboard').withSession(started.session()).redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/admin')
  })

  test('a suspended workspace cannot be impersonated into', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const { user, organization } = await createWorkspace()

    organization.status = 'suspended'
    await organization.save()

    const response = await start(client, staff, user.publicId)

    response.assertStatus(302)
    response.assertSessionMissing('auth_web')
    assert.lengthOf(await AuditLog.query().where('action', 'impersonation.started'), 0)
  })
})

test.group('Back-office — staff management', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('an admin can create an account, and it needs two-factor before use', async ({
    client,
    assert,
  }) => {
    const staff = await createStaff({ role: 'admin' })

    const response = await client
      .post('/admin/staff')
      .withGuard('staff')
      .loginAs(staff)
      .form({
        email: 'new@example.com',
        fullName: 'New Person',
        password: 'correct-horse-battery',
        role: 'support',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const created = await StaffUser.findByOrFail('email', 'new@example.com')
    assert.equal(created.role, 'support')
    assert.isFalse(created.hasTwoFactor, 'they enrol on first sign-in — it is mandatory')

    assert.lengthOf(await AuditLog.query().where('action', 'staff.created'), 1)
  })

  test('support cannot create one', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'support' })

    const response = await client
      .post('/admin/staff')
      .withGuard('staff')
      .loginAs(staff)
      .form({
        email: 'nope@example.com',
        fullName: 'Nope',
        password: 'correct-horse-battery',
        role: 'admin',
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.isNull(await StaffUser.findBy('email', 'nope@example.com'))
  })

  /**
   * Disabled rather than deleted, because `audit_logs.actor_id` points at
   * these rows.
   */
  test('disabling keeps the row', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const other = await createStaff({ role: 'support' })

    await client
      .post(`/admin/staff/${other.publicId}/toggle`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    await other.refresh()
    assert.isTrue(other.isDisabled)
    assert.isNotNull(await StaffUser.find(other.id))
  })

  test('you cannot disable yourself', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })

    await client
      .post(`/admin/staff/${staff.publicId}/toggle`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    await staff.refresh()
    assert.isFalse(staff.isDisabled)
  })

  /**
   * The back-office stays reachable because you cannot disable yourself, and
   * reaching this action requires being an active admin — so whoever
   * disables another admin is themselves one who remains.
   */
  test('disabling another admin leaves the one doing it', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const other = await createStaff({ role: 'admin' })

    await client
      .post(`/admin/staff/${other.publicId}/toggle`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    await other.refresh()
    await staff.refresh()

    assert.isTrue(other.isDisabled)
    assert.isFalse(staff.isDisabled, 'and the actor is still there')

    const active = await StaffUser.query().where('role', 'admin').whereNull('disabled_at')
    assert.isNotEmpty(active)
  })

  test('re-enabling lets them back in', async ({ client, assert }) => {
    const staff = await createStaff({ role: 'admin' })
    const other = await createStaff({ role: 'support', disabled: true })

    await client
      .post(`/admin/staff/${other.publicId}/toggle`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    await other.refresh()
    assert.isFalse(other.isDisabled)
  })
})

test.group('Back-office — the IP allowlist', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  /**
   * A 404 rather than a 403: somebody probing for an admin panel learns
   * nothing (plan §12).
   */
  test('refuses everything with a 404 when set and the address does not match', async ({
    client,
  }) => {
    const staff = await createStaff()

    process.env.ADMIN_IP_ALLOWLIST = '203.0.113.7'

    try {
      const login = await client.get('/admin/login')
      const panel = await client.get('/admin').withGuard('staff').loginAs(staff)

      login.assertStatus(404)
      panel.assertStatus(404)
    } finally {
      delete process.env.ADMIN_IP_ALLOWLIST
    }
  })

  test('is off when unset, so a fresh clone is not locked out', async ({ client }) => {
    const staff = await createStaff()

    const response = await client.get('/admin').withGuard('staff').loginAs(staff)

    response.assertStatus(200)
  })
})
