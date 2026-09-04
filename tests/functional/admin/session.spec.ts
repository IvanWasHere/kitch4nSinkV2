import { test } from '@japa/runner'

import { StaffUserFactory } from '#database/factories/staff_user_factory'
import { createWorkspace, enableTwoFactor, totpFor, TEST_PASSWORD } from '#tests/helpers'

test.group('Staff sign-in', () => {
  test('refuses a staff account that has no second factor', async ({ client }) => {
    const staff = await StaffUserFactory.create()

    const response = await client
      .post('/admin/login')
      .form({ email: staff.email, password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/admin/login')
    response.assertSessionMissing('auth_staff')
  })

  test('requires the second factor before creating a session', async ({ client }) => {
    const staff = await StaffUserFactory.create()
    const { secret } = await enableTwoFactor(staff)

    const login = await client
      .post('/admin/login')
      .form({ email: staff.email, password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    login.assertHeader('location', '/admin/two-factor')
    login.assertSessionMissing('auth_staff')

    const challenge = await client
      .post('/admin/two-factor')
      .withSession(login.session())
      .form({ code: await totpFor(secret) })
      .withCsrfToken()
      .redirects(0)

    challenge.assertHeader('location', '/admin')
    challenge.assertSession('auth_staff', staff.id)
  })

  test('refuses a disabled account', async ({ client }) => {
    const staff = await StaffUserFactory.create()
    await enableTwoFactor(staff)
    const { DateTime } = await import('luxon')
    staff.disabledAt = DateTime.utc()
    await staff.save()

    const response = await client
      .post('/admin/login')
      .form({ email: staff.email, password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'That account has been disabled.')
  })

  /**
   * The two guards are separate tables and separate sessions (D5): a tenant
   * session must be worth nothing at /admin, and vice versa.
   */
  test('a tenant session grants nothing in the back-office', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/admin').loginAs(user).redirects(0)

    response.assertHeader('location', '/admin/login')
  })

  test('a staff session grants nothing in the tenant application', async ({ client }) => {
    const staff = await StaffUserFactory.create()
    await enableTwoFactor(staff)

    const response = await client.get('/dashboard').withGuard('staff').loginAs(staff).redirects(0)

    response.assertHeader('location', '/login')
  })

  test('signs out', async ({ client }) => {
    const staff = await StaffUserFactory.create()
    await enableTwoFactor(staff)

    const response = await client
      .post('/admin/logout')
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/admin/login')
  })
})
