import { test } from '@japa/runner'

import {
  PUBLIC_ID_PREFIXES,
  generatePublicId,
  parsePublicId,
  type PublicIdResource,
} from '#models/public_id'

const resources = Object.keys(PUBLIC_ID_PREFIXES) as PublicIdResource[]

test.group('Public ids', () => {
  test('generates an id carrying the resource prefix', ({ assert }) => {
    for (const resource of resources) {
      const id = generatePublicId(resource)
      assert.match(id, new RegExp(`^${PUBLIC_ID_PREFIXES[resource]}_[a-z2-9]{12}$`), resource)
    }
  })

  test('never repeats an id', ({ assert }) => {
    const ids = new Set(Array.from({ length: 5_000 }, () => generatePublicId('todo')))
    assert.equal(ids.size, 5_000)
  })

  test('omits characters that are easy to misread', ({ assert }) => {
    const body = Array.from({ length: 2_000 }, () => generatePublicId('user').split('_')[1]).join(
      ''
    )
    for (const character of ['l', '1', 'i', 'o', '0']) {
      assert.notInclude(body, character, `expected no "${character}" in a public id`)
    }
  })

  test('accepts an id belonging to the expected resource', ({ assert }) => {
    const id = generatePublicId('todoList')
    assert.equal(parsePublicId('todoList', id), id)
  })

  /**
   * The whole point of the prefix: a list id must not be usable where a user
   * id is expected, so it cannot be smuggled through a route parameter.
   */
  test('rejects an id belonging to another resource', ({ assert }) => {
    assert.isNull(parsePublicId('user', generatePublicId('todoList')))
    assert.isNull(parsePublicId('organization', generatePublicId('staffUser')))
  })

  test('rejects malformed values', ({ assert }) => {
    assert.isNull(parsePublicId('user', 'usr_'))
    assert.isNull(parsePublicId('user', 'usr_TOOSHORT'))
    assert.isNull(parsePublicId('user', 'usr_ABCDEFGHIJKL'), 'uppercase is outside the alphabet')
    assert.isNull(parsePublicId('user', 'usr_abcdefghijk1'), 'digit 1 is outside the alphabet')
    assert.isNull(parsePublicId('user', 42))
    assert.isNull(parsePublicId('user', null))
    assert.isNull(parsePublicId('user', undefined))
  })

  test('gives every resource a distinct prefix', ({ assert }) => {
    const prefixes = Object.values(PUBLIC_ID_PREFIXES)
    assert.equal(new Set(prefixes).size, prefixes.length)
  })
})
