import { test } from '@japa/runner'

import { sniffBuffer } from '#storage/mime'
import { FILE_FIXTURES } from '#tests/helpers'

/**
 * Content sniffing (plan §10, §15).
 *
 * The browser's `Content-Type` is a claim by whoever made the request, so
 * these tests are the only thing standing between "somebody uploaded a .png"
 * and "somebody uploaded an HTML document called .png".
 */
test.group('Sniffing', () => {
  const cases: [keyof typeof FILE_FIXTURES, string, string][] = [
    ['png', 'png', 'image/png'],
    ['jpg', 'jpg', 'image/jpeg'],
    ['gif', 'gif', 'image/gif'],
    ['webp', 'webp', 'image/webp'],
    ['pdf', 'pdf', 'application/pdf'],
    ['txt', 'txt', 'text/plain'],
    ['csv', 'csv', 'text/csv'],
  ]

  for (const [fixture, extension, mimeType] of cases) {
    test(`recognises ${extension} as ${mimeType}`, ({ assert }) => {
      const result = sniffBuffer(Buffer.from(FILE_FIXTURES[fixture]), extension as any)

      assert.isNotNull(result)
      assert.equal(result!.mimeType, mimeType)
      assert.isTrue(result!.matchesExtension)
    })
  }

  test('jpeg and jpg are the same bytes under two names', ({ assert }) => {
    const result = sniffBuffer(Buffer.from(FILE_FIXTURES.jpg), 'jpeg')

    assert.isTrue(result!.matchesExtension)
  })

  /**
   * The header wins over the name, and the mismatch is reported rather than
   * corrected — renaming a file to match its bytes is how something
   * executable ends up stored as an image.
   */
  test('reports a real PDF wearing a .png name as a mismatch', ({ assert }) => {
    const result = sniffBuffer(Buffer.from(FILE_FIXTURES.pdf), 'png')

    assert.isNotNull(result)
    assert.equal(result!.mimeType, 'application/pdf')
    assert.isFalse(result!.matchesExtension)
  })

  /**
   * The attack this exists for.
   */
  test('refuses an HTML document named .png', ({ assert }) => {
    assert.isNull(sniffBuffer(Buffer.from(FILE_FIXTURES.html), 'png'))
  })

  test('refuses an HTML document even named .txt', ({ assert }) => {
    assert.isNull(sniffBuffer(Buffer.from(FILE_FIXTURES.html), 'txt'))
  })

  test('refuses binary with no recognised header', ({ assert }) => {
    const bytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])

    assert.isNull(sniffBuffer(bytes, 'png'))
    assert.isNull(sniffBuffer(bytes, 'txt'), 'and cannot be smuggled in as text')
  })

  /**
   * A NUL byte is the cheap, reliable tell that something is not text.
   */
  test('refuses text containing a NUL byte', ({ assert }) => {
    const bytes = Buffer.concat([Buffer.from('name,qty\n', 'utf8'), Buffer.from([0x00])])

    assert.isNull(sniffBuffer(bytes, 'csv'))
  })

  test('a truncated signature is not a match', ({ assert }) => {
    assert.isNull(sniffBuffer(Buffer.from([0x89, 0x50]), 'png'))
  })

  /**
   * WebP's four length bytes vary per file, so the signature has to skip
   * them — a matcher that compared all twelve would reject every real WebP
   * but the fixture.
   */
  test('webp matches whatever its length field says', ({ assert }) => {
    const bytes = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0xff, 0xee, 0xdd, 0xcc]),
      Buffer.from('WEBP', 'ascii'),
    ])

    assert.equal(sniffBuffer(bytes, 'webp')!.mimeType, 'image/webp')
  })

  test('RIFF that is not WEBP is refused', ({ assert }) => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'ascii'),
    ])

    assert.isNull(sniffBuffer(wav, 'webp'))
  })
})
