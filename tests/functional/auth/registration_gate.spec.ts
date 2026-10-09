import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import mail from '@adonisjs/mail/services/main'

import User from '#models/user'
import registration from '#auth/registration_service'
import registrationGate, { RegistrationGate } from '#auth/registration_gate'
import invitations from '#organizations/invitation_service'
import RegistrationClosedException from '#exceptions/registration_closed_exception'
import { createWorkspace, TEST_PASSWORD } from '#tests/helpers'

/**
 * The registration gate (plan §22.2, D10).
 *
 * Nothing in core closes it — Registration Control will — so these tests
 * close it by hand, exactly as that module's resolver will.
 */
test.group('Registration gate', (group) => {
  group.each.setup(() => {
    mail.fake()
    const booted = registrationGate.current()

    return () => {
      mail.restore()
      registrationGate.decideWith(booted)
    }
  })

  const signupForm = {
    fullName: 'Jane Cooper',
    email: 'jane@example.com',
    password: TEST_PASSWORD,
    passwordConfirmation: TEST_PASSWORD,
  }

  test('is open when nothing has registered a resolver', async ({ assert }) => {
    assert.isTrue(await new RegistrationGate().isOpen())
  })

  test('a closed gate refuses a direct signup POST and writes nothing', async ({
    client,
    assert,
  }) => {
    registrationGate.decideWith(() => false)

    const response = await client.post('/signup').form(signupForm).withCsrfToken().redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', RegistrationClosedException.destination)
    assert.isNull(await User.findBy('email', 'jane@example.com'))
  })

  /**
   * A closed form must not become an "is this address registered?" oracle.
   * The validator's unique-email check would answer that, so the gate runs
   * before it.
   */
  test('a closed gate answers a taken and a free address identically', async ({ client }) => {
    await createWorkspace({ email: 'taken@example.com' })
    registrationGate.decideWith(() => false)

    for (const email of ['taken@example.com', 'free@example.com']) {
      const response = await client
        .post('/signup')
        .form({ ...signupForm, email })
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
      response.assertHeader('location', RegistrationClosedException.destination)
      response.assertFlashMessage('error', 'New accounts are not being created right now.')
    }
  })

  /**
   * Where a closed signup page sends people depends on whether a feature
   * offers a waiting list — Registration Control does, a build without it
   * does not. Both are core's behaviour, so both are asserted here, and the
   * one that applies is the one this build has.
   */
  test('a closed signup page offers the waiting list, or says it is closed', async ({
    client,
    assert,
  }) => {
    registrationGate.decideWith(() => false)

    const response = await client.get('/signup').redirects(0)

    if (router.find('waitlist.create')) {
      response.assertStatus(302)
      response.assertHeader('location', router.makeUrl('waitlist.create'))
      return
    }

    response.assertStatus(200)
    response.assertTextIncludes('We are not creating new accounts right now')
    assert.notInclude(response.text(), 'Create account')
  })

  /**
   * Social sign-in reaches the same service, so the service refusing is what
   * keeps a first-time Google account from slipping past a closed form.
   */
  test('the service itself refuses, whichever door the request came in by', async ({ assert }) => {
    registrationGate.decideWith(async () => false)

    for (const via of ['signup', 'social'] as const) {
      await assert.rejects(
        () => registration.register({ fullName: null, email: `${via}@example.com`, via }),
        RegistrationClosedException
      )
    }

    assert.lengthOf(
      await User.query().whereIn('email', ['signup@example.com', 'social@example.com']),
      0
    )
  })

  test('existing accounts still sign in while the gate is closed', async ({ client }) => {
    await createWorkspace({ email: 'existing@example.com' })
    registrationGate.decideWith(() => false)

    const response = await client
      .post('/login')
      .form({ email: 'existing@example.com', password: TEST_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/dashboard')
  })

  /**
   * An owner adding a colleague is not public registration (plan §22.2).
   */
  test('an invitation can still be accepted while the gate is closed', async ({
    client,
    assert,
  }) => {
    const { user, organization } = await createWorkspace()
    const { token } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'colleague@example.com',
    })

    registrationGate.decideWith(() => false)

    const response = await client
      .post(`/invitations/${token}/accept`)
      .form({
        fullName: 'Sam Member',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/dashboard')
    assert.exists(await User.findBy('email', 'colleague@example.com'))
  })

  test('reopening restores signup', async ({ client, assert }) => {
    registrationGate.decideWith(() => false)
    registrationGate.decideWith(() => true)

    const response = await client.post('/signup').form(signupForm).withCsrfToken().redirects(0)

    response.assertStatus(302)
    assert.exists(await User.findBy('email', 'jane@example.com'))
  })
})
