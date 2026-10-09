import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import testUtils from '@adonisjs/core/services/test_utils'

import { createWorkspace } from '#tests/helpers'

/**
 * `/` and the route named `home` (plan §22.7).
 *
 * Every layout and error page links to `home`, so it must exist whether or not
 * a feature provides a front page. Without one, core's fallback sends people
 * inward; with one, that feature's page answers — both are core's contract,
 * and the branch asserted is the one this build has.
 */
test.group('Home', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('the home route always exists at /', ({ assert }) => {
    assert.isNotNull(router.find('home'))
    assert.equal(router.makeUrl('home'), '/')
  })

  test('without a front page, / sends people inward', async ({ client }) => {
    if (router.find('legal.privacy')) {
      /**
       * A Landing module is installed and answers `/` itself — its own suite
       * covers that. This case is the fallback, which only answers when
       * nothing has replaced it.
       */
      const response = await client.get('/')
      response.assertStatus(200)
      return
    }

    const visitor = await client.get('/').redirects(0)
    visitor.assertStatus(302)
    visitor.assertHeader('location', '/login')

    const { user } = await createWorkspace()
    const member = await client.get('/').loginAs(user).redirects(0)
    member.assertStatus(302)
    member.assertHeader('location', '/dashboard')
  })
})
