import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import settings from '#settings/settings_service'
import { createWorkspace } from '#tests/helpers'

/**
 * The Landing module (plan §22.7).
 */
test.group('Landing', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('/ is the marketing page, and still answers to the name home', async ({
    client,
    assert,
  }) => {
    const response = await client.get('/')

    response.assertStatus(200)
    response.assertTextIncludes('Ship a billable SaaS')

    const { default: router } = await import('@adonisjs/core/services/router')
    assert.equal(router.makeUrl('home'), '/')
  })

  test('the legal pages render, and are linked from the footer', async ({ client }) => {
    for (const [path, heading] of [
      ['/privacy', 'Privacy notice'],
      ['/terms', 'Terms of service'],
    ]) {
      const response = await client.get(path)
      response.assertStatus(200)
      response.assertTextIncludes(heading)
    }

    const home = await client.get('/')
    home.assertTextIncludes('href="/privacy"')
    home.assertTextIncludes('href="/terms"')
  })

  test('the legal pages reach a signed-in user as well', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/privacy').loginAs(user)

    response.assertStatus(200)
  })

  test('while registration is open, the call to action is signup', async ({ client, assert }) => {
    const response = await client.get('/')
    const html = response.text()

    assert.include(html, 'Start for free')
    assert.include(html, 'Get started')
    assert.notInclude(html, 'Join the waiting list')
  })

  /**
   * Landing reads core's gate. With Registration Control installed, closing
   * registration there turns the call to action into the waiting list.
   */
  test('while registration is closed, it is the waiting list', async ({ client, assert }) => {
    await settings.set('registration_enabled', false)

    const response = await client.get('/')
    const html = response.text()

    assert.notInclude(html, 'Start for free')
    assert.notInclude(html, 'Get started')
    assert.include(html, 'Join the waiting list')
    assert.include(html, 'href="/waitlist"')
  })

  test('a signed-in visitor is offered their workspace', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/').loginAs(user)
    const html = response.text()

    assert.include(html, 'Go to your workspace')
    assert.notInclude(html, 'Start for free')
  })

  test('signup links the terms and the privacy notice', async ({ client }) => {
    const response = await client.get('/signup')

    response.assertTextIncludes('href="/terms"')
    response.assertTextIncludes('href="/privacy"')
  })

  /**
   * The pricing cards are read from `config/plans.ts`, so the page can never
   * advertise a tier or a price the product does not have.
   */
  test('pricing shows the configured plans and prices', async ({ client, assert }) => {
    const { plans } = await import('#config/plans')
    const response = await client.get('/')
    const html = response.text()

    for (const plan of Object.values(plans)) {
      assert.include(html, `<h3>${plan.name}</h3>`)
      assert.include(html, `$${(plan.priceCents / 100).toFixed(0)}`)
    }
  })

  test('the landing styles load on the landing page only', async ({ client, assert }) => {
    const home = await client.get('/')
    const login = await client.get('/login')

    assert.include(home.text(), 'landing.css')
    assert.notInclude(login.text(), 'landing.css')
  })
})
