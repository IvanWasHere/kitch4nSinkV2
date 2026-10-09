import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'

import User from '#models/user'
import AuditLog from '#models/audit_log'
import settings from '#settings/settings_service'
import { createStaff, TEST_PASSWORD } from '#tests/helpers'

/**
 * Admin → Settings → Registration (plan §22.5).
 */
test.group('Registration settings', (group) => {
  group.each.setup(async () => {
    await testUtils.db().truncate()
    mail.fake()
    return () => mail.restore()
  })

  test('an admin sees the current values', async ({ client }) => {
    const admin = await createStaff({ role: 'admin' })

    const response = await client
      .get('/admin/settings/registration')
      .withGuard('staff')
      .loginAs(admin)

    response.assertStatus(200)
    response.assertTextIncludes('Public registration is open')
    response.assertTextIncludes('Existing accounts are never affected')
  })

  test('support cannot reach the screen or change anything', async ({ client, assert }) => {
    const support = await createStaff({ role: 'support' })

    const page = await client
      .get('/admin/settings/registration')
      .withGuard('staff')
      .loginAs(support)
    page.assertStatus(403)

    const save = await client
      .post('/admin/settings/registration')
      .withGuard('staff')
      .loginAs(support)
      .form({ waitingListDoubleOptIn: '1' })
      .withCsrfToken()
      .redirects(0)

    /**
     * A refused form POST goes back with a flash, as everywhere else in the
     * back-office — what matters is that nothing was written.
     */
    save.assertStatus(302)
    assert.isTrue(await settings.get('registration_enabled'))
    assert.lengthOf(await AuditLog.query().where('action', 'settings.changed'), 0)
  })

  test('the item is in the admin sidebar for admins only', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    const support = await createStaff({ role: 'support' })

    const asAdmin = await client.get('/admin').withGuard('staff').loginAs(admin)
    const asSupport = await client.get('/admin').withGuard('staff').loginAs(support)

    assert.include(asAdmin.text(), '/admin/settings/registration')
    assert.notInclude(asSupport.text(), '/admin/settings/registration')
  })

  /**
   * The whole point of the screen: an unticked box closes signup, and the
   * gate core enforces reads the stored value.
   */
  test('closing registration from the screen stops signup', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })

    const save = await client
      .post('/admin/settings/registration')
      .withGuard('staff')
      .loginAs(admin)
      .form({ waitingListDoubleOptIn: '1' })
      .withCsrfToken()
      .redirects(0)

    save.assertStatus(302)
    save.assertHeader('location', '/admin/settings/registration')
    assert.isFalse(await settings.get('registration_enabled'))
    assert.isTrue(await settings.get('waiting_list_double_opt_in'))

    const signup = await client
      .post('/signup')
      .form({
        fullName: 'Jane Cooper',
        email: 'jane@example.com',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    signup.assertStatus(302)
    assert.isNull(await User.findBy('email', 'jane@example.com'))
  })

  test('reopening registration restores signup', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    await settings.set('registration_enabled', false)

    await client
      .post('/admin/settings/registration')
      .withGuard('staff')
      .loginAs(admin)
      .form({ registrationEnabled: '1', waitingListDoubleOptIn: '1' })
      .withCsrfToken()
      .redirects(0)

    const signup = await client
      .post('/signup')
      .form({
        fullName: 'Jane Cooper',
        email: 'jane@example.com',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    signup.assertStatus(302)
    assert.exists(await User.findBy('email', 'jane@example.com'))
  })

  test('each change is audited against the admin who made it', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })

    await client
      .post('/admin/settings/registration')
      .withGuard('staff')
      .loginAs(admin)
      .form({})
      .withCsrfToken()
      .redirects(0)

    const entries = await AuditLog.query().where('action', 'settings.changed').orderBy('id', 'asc')

    assert.lengthOf(entries, 2)
    assert.deepEqual(
      entries.map((entry) => entry.metadata),
      [
        { key: 'registration_enabled', from: true, to: false, staffEmail: admin.email },
        { key: 'waiting_list_double_opt_in', from: true, to: false, staffEmail: admin.email },
      ]
    )
    assert.isTrue(
      entries.every((entry) => entry.actorType === 'staff' && entry.actorId === admin.id)
    )
  })

  test('saving without changing anything writes no audit entry', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })

    const response = await client
      .post('/admin/settings/registration')
      .withGuard('staff')
      .loginAs(admin)
      .form({ registrationEnabled: '1', waitingListDoubleOptIn: '1' })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('success', 'Nothing changed.')
    assert.lengthOf(await AuditLog.query().where('action', 'settings.changed'), 0)
  })
})
