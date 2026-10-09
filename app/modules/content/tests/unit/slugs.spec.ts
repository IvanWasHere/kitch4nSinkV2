import { test } from '@japa/runner'

import { slugify, SLUG_PATTERN } from '#modules/content/services/slugs'

test.group('Content slugs', () => {
  test('slugify', ({ assert }) => {
    assert.equal(slugify('Hello, World!'), 'hello-world')
    assert.equal(slugify('  Spaces   and --- dashes  '), 'spaces-and-dashes')
    assert.equal(slugify('!!!'), 'untitled')
    assert.match(slugify('x'.repeat(300)), SLUG_PATTERN)
    assert.isAtMost(slugify('x'.repeat(300)).length, 120)
  })
})
