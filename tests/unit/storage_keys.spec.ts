import { test } from '@japa/runner'
import { DateTime } from 'luxon'

import {
  ALLOWED_EXTENSIONS,
  buildObjectKey,
  keyBelongsTo,
  normalizeExtension,
  organizationPrefix,
} from '#storage/keys'

/**
 * The key convention (plan §10, §15).
 *
 * `orgs/{organization_public_id}/{yyyy}/{mm}/{uuid}.{ext}` — and the part
 * that matters is that the tenant comes first, which is what makes a
 * per-tenant policy, export or sweep a prefix operation.
 */
test.group('Storage keys', () => {
  const at = DateTime.fromISO('2026-09-07T10:00:00.000Z', { zone: 'utc' })

  test('puts the tenant first, then the date', ({ assert }) => {
    const key = buildObjectKey({ organizationPublicId: 'org_abcdefghjkmn', extension: 'png', at })

    assert.match(key, /^orgs\/org_abcdefghjkmn\/2026\/09\/[0-9a-f-]{36}\.png$/)
  })

  /**
   * The client's filename never becomes the key (CVE-2026-21440). Path
   * traversal, a second extension and somebody else's key all arrive the same
   * way: in a filename.
   */
  test('the key is a uuid, never anything from the request', ({ assert }) => {
    const key = buildObjectKey({
      organizationPublicId: 'org_abcdefghjkmn',
      extension: 'png',
      at,
    })

    assert.notInclude(key, '..')
    assert.lengthOf(key.split('/'), 5)
  })

  test('two uploads in the same month never collide', ({ assert }) => {
    const keys = new Set(
      Array.from({ length: 500 }, () =>
        buildObjectKey({ organizationPublicId: 'org_abcdefghjkmn', extension: 'png', at })
      )
    )

    assert.equal(keys.size, 500)
  })

  test('a prefix names everything one workspace has', ({ assert }) => {
    const prefix = organizationPrefix('org_abcdefghjkmn')
    const key = buildObjectKey({ organizationPublicId: 'org_abcdefghjkmn', extension: 'pdf', at })

    assert.equal(prefix, 'orgs/org_abcdefghjkmn/')
    assert.isTrue(key.startsWith(prefix))
  })

  test('a key can be checked against the workspace it should belong to', ({ assert }) => {
    const key = buildObjectKey({ organizationPublicId: 'org_abcdefghjkmn', extension: 'pdf', at })

    assert.isTrue(keyBelongsTo(key, 'org_abcdefghjkmn'))
    assert.isFalse(keyBelongsTo(key, 'org_somebodyelse'))
  })

  /**
   * A prefix must not match a *longer* organisation id that starts with it,
   * which is what the trailing slash is for.
   */
  test('one workspace id is not a prefix of another', ({ assert }) => {
    assert.isFalse(keyBelongsTo('orgs/org_abcdefghjkmnop/2026/09/x.png', 'org_abcdefghjkmn'))
  })
})

test.group('Extension allowlist', () => {
  test('accepts every extension on the list', ({ assert }) => {
    for (const extension of ALLOWED_EXTENSIONS) {
      assert.equal(normalizeExtension(`report.${extension}`), extension, extension)
    }
  })

  test('is case-insensitive', ({ assert }) => {
    assert.equal(normalizeExtension('HOLIDAY.PNG'), 'png')
  })

  test('refuses anything else', ({ assert }) => {
    for (const name of ['payload.exe', 'script.sh', 'archive.zip', 'vector.svg', 'page.html']) {
      assert.isNull(normalizeExtension(name), name)
    }
  })

  /**
   * SVG is deliberately not on the list: it is a document that can carry
   * script, and serving one from our own domain is stored XSS.
   */
  test('svg is not an accepted image', ({ assert }) => {
    assert.isNull(normalizeExtension('logo.svg'))
  })

  test('refuses a file with no extension at all', ({ assert }) => {
    assert.isNull(normalizeExtension('README'))
  })

  /**
   * Only the last extension counts, so `invoice.pdf.exe` is an exe.
   */
  test('a double extension is judged by its last part', ({ assert }) => {
    assert.isNull(normalizeExtension('invoice.pdf.exe'))
    assert.equal(normalizeExtension('invoice.exe.pdf'), 'pdf')
  })
})
