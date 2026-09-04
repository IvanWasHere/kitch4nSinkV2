import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import User from '#models/user'
import Organization from '#models/organization'
import registration from '#auth/registration_service'
import VerifyEmailNotification from '#mail/mails/verify_email_notification'
import { TEST_PASSWORD } from '#tests/helpers'

test.group('Registration', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('creates an organisation and its owner together', async ({ client, assert }) => {
    const response = await client
      .post('/signup')
      .form({
        fullName: 'Jane Cooper',
        organizationName: 'Acme',
        email: 'jane@example.com',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const user = await User.findByOrFail('email', 'jane@example.com')
    const organization = await Organization.findByOrFail('id', user.organizationId)

    assert.equal(user.role, 'owner')
    assert.equal(organization.ownerId, user.id)
    assert.equal(organization.name, 'Acme')
    assert.equal(organization.slug, 'acme')
    assert.equal(organization.planKey, 'free')
    assert.match(user.publicId, /^usr_/)
    assert.match(organization.publicId, /^org_/)
  })

  test('sends a verification email', async ({ client }) => {
    const { mails } = mail.fake()

    await client
      .post('/signup')
      .form({
        fullName: 'Jane Cooper',
        email: 'jane@example.com',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    mails.assertSent(VerifyEmailNotification)
  })

  test('lowercases the email so sign-in is case-insensitive', async ({ assert }) => {
    const { user } = await registration.register({
      fullName: null,
      email: '  Jane.Cooper@Example.COM ',
      password: TEST_PASSWORD,
    })

    assert.equal(user.email, 'jane.cooper@example.com')
  })

  test('rejects an email that already has an account', async ({ client, assert }) => {
    await registration.register({
      fullName: null,
      email: 'taken@example.com',
      password: TEST_PASSWORD,
    })

    const response = await client
      .post('/signup')
      .form({
        fullName: 'Someone Else',
        email: 'taken@example.com',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    assert.lengthOf(await User.query().where('email', 'taken@example.com'), 1)
  })

  test('disambiguates a slug that is already taken', async ({ assert }) => {
    const first = await registration.register({
      fullName: null,
      email: 'a@example.com',
      password: TEST_PASSWORD,
      organizationName: 'Acme',
    })
    const second = await registration.register({
      fullName: null,
      email: 'b@example.com',
      password: TEST_PASSWORD,
      organizationName: 'Acme',
    })

    assert.equal(first.organization.slug, 'acme')
    assert.equal(second.organization.slug, 'acme-2')
  })

  test('never claims a slug that would shadow an application route', async ({ assert }) => {
    const { organization } = await registration.register({
      fullName: null,
      email: 'admin-lover@example.com',
      password: TEST_PASSWORD,
      organizationName: 'admin',
    })

    assert.notEqual(organization.slug, 'admin')
  })

  /**
   * The organisation and the owner must appear together or not at all — a
   * user with no organisation has nothing to belong to and no way to recover.
   */
  test('leaves nothing behind when the user insert fails', async ({ assert }) => {
    await registration.register({
      fullName: null,
      email: 'clash@example.com',
      password: TEST_PASSWORD,
    })

    const organizationsBefore = await Organization.query().count('* as total')

    await assert.rejects(() =>
      registration.register({
        fullName: null,
        email: 'clash@example.com',
        password: TEST_PASSWORD,
        organizationName: 'Second Attempt',
      })
    )

    const organizationsAfter = await Organization.query().count('* as total')
    assert.deepEqual(organizationsAfter[0].$extras.total, organizationsBefore[0].$extras.total)
    assert.isNull(await Organization.findBy('name', 'Second Attempt'))
  })

  test('names the workspace after the user when none is given', async ({ assert }) => {
    const { organization } = await registration.register({
      fullName: 'Jane Cooper',
      email: 'jane2@example.com',
      password: TEST_PASSWORD,
    })

    assert.equal(organization.name, "Jane Cooper's workspace")
  })
})
