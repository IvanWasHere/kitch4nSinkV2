import { test } from '@japa/runner'

import {
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  parseAuthorizationHeader,
  PREFIX_LENGTH,
} from '#api/keys'
import { API_SCOPES, DEFAULT_SCOPES, isApiScope, normalizeScopes } from '#api/scopes'
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  pageSize,
  toCursorPage,
} from '#api/cursor'

/**
 * Key generation and hashing (plan §15).
 */
test.group('API keys', () => {
  test('is prefixed by environment so a script cannot be pointed at the wrong one', ({
    assert,
  }) => {
    assert.isTrue(generateApiKey('live').secret.startsWith('sk_live_'))
    assert.isTrue(generateApiKey('test').secret.startsWith('sk_test_'))
  })

  test('the stored prefix is recognisable and useless on its own', ({ assert }) => {
    const { secret, prefix } = generateApiKey()

    assert.lengthOf(prefix, PREFIX_LENGTH)
    assert.isTrue(secret.startsWith(prefix))
    assert.isBelow(prefix.length, secret.length / 2, 'far too short to narrow a brute force')
  })

  test('two keys are never the same', ({ assert }) => {
    const secrets = new Set(Array.from({ length: 500 }, () => generateApiKey().secret))

    assert.equal(secrets.size, 500)
  })

  test('hashing is stable and one-way', ({ assert }) => {
    const { secret, hash } = generateApiKey()

    assert.equal(hashApiKey(secret), hash, 'the same key always hashes the same')
    assert.match(hash, /^[0-9a-f]{64}$/)
    assert.notInclude(hash, secret.slice(8), 'the secret is not recoverable from the hash')
  })

  test('a different key hashes differently', ({ assert }) => {
    assert.notEqual(hashApiKey('sk_live_a'), hashApiKey('sk_live_b'))
  })

  test('recognises its own key format', ({ assert }) => {
    assert.isTrue(looksLikeApiKey(generateApiKey().secret))
    assert.isFalse(looksLikeApiKey('sk_live_short'))
    assert.isFalse(looksLikeApiKey('pk_live_' + 'a'.repeat(32)))
    assert.isFalse(looksLikeApiKey('sk_prod_' + 'a'.repeat(32)))
  })

  /**
   * A malformed header must cost a regex, not a database lookup.
   */
  test('parses a bearer header and rejects everything else', ({ assert }) => {
    const { secret } = generateApiKey()

    assert.equal(parseAuthorizationHeader(`Bearer ${secret}`), secret)
    assert.equal(parseAuthorizationHeader(`bearer ${secret}`), secret, 'case-insensitive')
    assert.isNull(parseAuthorizationHeader(secret), 'no scheme')
    assert.isNull(parseAuthorizationHeader(`Basic ${secret}`))
    assert.isNull(parseAuthorizationHeader('Bearer '))
    assert.isNull(parseAuthorizationHeader(undefined))
    assert.isNull(parseAuthorizationHeader(`Bearer not-one-of-ours`))
  })
})

test.group('API scopes', () => {
  test('the default is read-only', ({ assert }) => {
    assert.deepEqual(DEFAULT_SCOPES, ['lists:read', 'todos:read', 'members:read'])

    for (const scope of DEFAULT_SCOPES) {
      assert.notInclude(scope, ':write', 'nothing a pasted script could destroy')
    }
  })

  test('recognises only the published scopes', ({ assert }) => {
    for (const scope of API_SCOPES) {
      assert.isTrue(isApiScope(scope), scope)
    }

    assert.isFalse(isApiScope('lists:delete'))
    assert.isFalse(isApiScope('*'))
    assert.isFalse(isApiScope(undefined))
  })

  test('normalising drops anything unrecognised', ({ assert }) => {
    assert.deepEqual(normalizeScopes(['lists:read', 'admin', '*']), ['lists:read'])
    assert.deepEqual(normalizeScopes('lists:read'), [], 'not an array')
    assert.deepEqual(normalizeScopes(undefined), [])
  })

  test('normalising de-duplicates and gives a stable order', ({ assert }) => {
    assert.deepEqual(normalizeScopes(['todos:read', 'lists:read', 'lists:read']), [
      'lists:read',
      'todos:read',
    ])
  })
})

/**
 * Cursor pagination (plan §11). Offset pagination is what this avoids: under
 * concurrent writes it duplicates and skips rows without ever erroring.
 */
test.group('Cursor pagination', () => {
  test('a cursor round-trips', ({ assert }) => {
    assert.equal(decodeCursor(encodeCursor(42)), 42)
  })

  test('a cursor is opaque, so our numbering is not part of the contract', ({ assert }) => {
    assert.notInclude(encodeCursor(42), '42')
  })

  /**
   * A truncated query string must not kill a sync loop.
   */
  test('a broken cursor is treated as the beginning, not an error', ({ assert }) => {
    assert.isNull(decodeCursor('not-base64-at-all!!'))
    assert.isNull(decodeCursor(Buffer.from('id:abc').toString('base64url')))
    assert.isNull(decodeCursor(Buffer.from('other:1').toString('base64url')))
    assert.isNull(decodeCursor(''))
    assert.isNull(decodeCursor(undefined))
    assert.isNull(decodeCursor(encodeCursor(0)), 'ids start at 1')
  })

  test('the page size is clamped rather than refused', ({ assert }) => {
    assert.equal(pageSize(undefined), DEFAULT_PAGE_SIZE)
    assert.equal(pageSize('10'), 10)
    assert.equal(pageSize(10_000), MAX_PAGE_SIZE)
    assert.equal(pageSize(0), DEFAULT_PAGE_SIZE)
    assert.equal(pageSize(-5), DEFAULT_PAGE_SIZE)
    assert.equal(pageSize('nonsense'), DEFAULT_PAGE_SIZE)
    assert.equal(pageSize(2.7), 2, 'floored')
  })

  /**
   * The extra row is how "is there a next page?" is answered without a
   * second COUNT(*).
   */
  test('a full page plus one yields a next cursor', ({ assert }) => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]
    const page = toCursorPage(rows, 2)

    assert.deepEqual(page.rows, [{ id: 1 }, { id: 2 }])
    assert.equal(decodeCursor(page.nextCursor), 2, 'points at the last row returned')
  })

  test('the last page has a null cursor, which is how a sync knows it is done', ({ assert }) => {
    assert.isNull(toCursorPage([{ id: 1 }, { id: 2 }], 2).nextCursor)
    assert.isNull(toCursorPage([], 2).nextCursor)
  })
})
