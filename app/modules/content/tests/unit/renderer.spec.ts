import { test } from '@japa/runner'

import { isSafeLink, plainText, renderMarkdown } from '#modules/content/services/renderer'

/**
 * The renderer is what stands between a post body and every visitor's
 * browser (plan §22.6). Each case is a way stored content becomes script.
 */
test.group('Content renderer — XSS', () => {
  test('raw HTML in the source is escaped, not passed through', ({ assert }) => {
    const html = renderMarkdown('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>')

    assert.notInclude(html, '<script>')
    assert.notInclude(html, '<img')
    assert.include(html, '&lt;script&gt;')
  })

  test('an HTML block is escaped too', ({ assert }) => {
    const html = renderMarkdown('<div onclick="alert(1)">\n\nclick\n\n</div>')

    assert.notInclude(html, '<div onclick')
  })

  for (const href of [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'javascript&#58;alert(1)',
    'java\nscript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  ]) {
    test(`a link to ${JSON.stringify(href)} is not a link`, ({ assert }) => {
      const html = renderMarkdown(`[click](${href})`)

      assert.notMatch(html, /href="[^"]*script:/i)
      assert.notMatch(html, /href="data:/i)
    })
  }

  test('an image with a data: URL is not an image', ({ assert }) => {
    const html = renderMarkdown('![x](data:image/svg+xml;base64,PHN2Zy8+)')

    assert.notInclude(html, '<img')
  })

  test('ordinary links and images survive', ({ assert }) => {
    const html = renderMarkdown(
      '[docs](https://example.com) [about](/about) [mail](mailto:hi@example.com) ![logo](/assets/logo.png)'
    )

    assert.include(html, 'href="https://example.com"')
    assert.include(html, 'href="/about"')
    assert.include(html, 'href="mailto:hi@example.com"')
    assert.include(html, 'src="/assets/logo.png"')
  })

  test('external links cannot reach back through window.opener', ({ assert }) => {
    const html = renderMarkdown('[out](https://example.com)')

    assert.include(html, 'rel="noopener noreferrer"')
  })

  test('the scheme check', ({ assert }) => {
    assert.isTrue(isSafeLink('https://example.com'))
    assert.isTrue(isSafeLink('/relative'))
    assert.isTrue(isSafeLink('#anchor'))
    assert.isTrue(isSafeLink('page'))
    assert.isFalse(isSafeLink('javascript:alert(1)'))
    assert.isFalse(isSafeLink(' Javascript:alert(1)'))
    assert.isFalse(isSafeLink('file:///etc/passwd'))
  })
})

test.group('Content renderer — plain text', () => {
  test('strips Markdown and tags for a description', ({ assert }) => {
    assert.equal(
      plainText('## Hello\n\nThis is **bold** and [a link](/x).'),
      'Hello This is bold and a link.'
    )
  })

  test('truncates with an ellipsis', ({ assert }) => {
    const text = plainText('word '.repeat(100), 20)

    assert.isAtMost(text.length, 20)
    assert.isTrue(text.endsWith('…'))
  })
})
