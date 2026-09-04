import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import { generateOrganizationSlug } from '#auth/slug'
import { OrganizationFactory } from '#database/factories/organization_factory'

test.group('Organisation slugs', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('slugifies a name', async ({ assert }) => {
    assert.equal(await generateOrganizationSlug('Acme Corporation'), 'acme-corporation')
    assert.equal(await generateOrganizationSlug('  Ünïcode & Symbols!  '), 'unicode-and-symbols')
  })

  test('falls back for a name with nothing slugifiable in it', async ({ assert }) => {
    assert.equal(await generateOrganizationSlug('!!!'), 'workspace')
  })

  test('disambiguates against existing slugs', async ({ assert }) => {
    await OrganizationFactory.merge({ slug: 'acme' }).create()
    assert.equal(await generateOrganizationSlug('Acme'), 'acme-2')

    await OrganizationFactory.merge({ slug: 'acme-2' }).create()
    assert.equal(await generateOrganizationSlug('Acme'), 'acme-3')
  })

  /**
   * An organisation slug that matched a route would shadow it.
   */
  test('never returns a reserved word', async ({ assert }) => {
    for (const reserved of ['admin', 'api', 'login', 'settings', 'billing']) {
      assert.notEqual(await generateOrganizationSlug(reserved), reserved)
    }
  })

  test('caps the length', async ({ assert }) => {
    const slug = await generateOrganizationSlug('a'.repeat(200))
    assert.isAtMost(slug.length, 48)
  })
})
