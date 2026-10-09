import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'

import { reservedSlugs } from '#modules/content/services/slugs'

/**
 * The reserved list is the route table (plan §22.6, D13). A functional test
 * rather than a unit one: the router only lists its routes once the HTTP
 * server has committed them, which the unit suite never starts.
 *
 * It iterates the real router, so a route added next year is covered here
 * the day it is added.
 */
test.group('Content slugs — reserved', () => {
  test('the first segment of every registered route is reserved', ({ assert }) => {
    const reserved = reservedSlugs()
    let checked = 0

    for (const routes of Object.values(router.toJSON())) {
      for (const route of routes) {
        const first = route.pattern.split('/').find(Boolean)

        if (first && !first.startsWith(':')) {
          assert.isTrue(reserved.has(first), `${first} (from ${route.pattern}) is reserved`)
          checked++
        }
      }
    }

    assert.isAbove(checked, 20, 'the router was populated when this ran')

    for (const word of ['login', 'signup', 'admin', 'api', 'posts', 'dashboard', 'assets']) {
      assert.isTrue(reserved.has(word), `${word} is reserved`)
    }
  })
})
