import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import ContentEntry from '#modules/content/models/content_entry'
import ContentSlugRedirect from '#modules/content/models/content_slug_redirect'

/**
 * The public side of Content (plan §22.6).
 */
test.group('Content — public', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  function publish(
    type: 'post' | 'page',
    slug: string,
    overrides: Partial<{
      title: string
      status: ContentEntry['status']
      publishedAt: DateTime | null
      body: string
      excerpt: string
    }> = {}
  ) {
    return ContentEntry.create({
      type,
      slug,
      title: overrides.title ?? slug,
      body: overrides.body ?? `Body of ${slug}`,
      excerpt: overrides.excerpt ?? null,
      status: overrides.status ?? 'published',
      publishedAt:
        overrides.publishedAt === undefined
          ? DateTime.utc().minus({ hours: 1 })
          : overrides.publishedAt,
    })
  }

  test('only published posts are listed — no drafts, archives, schedules or pages', async ({
    client,
    assert,
  }) => {
    await publish('post', 'live-post', { title: 'Live post' })
    await publish('post', 'draft-post', { title: 'Draft post', status: 'draft', publishedAt: null })
    await publish('post', 'archived-post', { title: 'Archived post', status: 'archived' })
    await publish('post', 'future-post', {
      title: 'Future post',
      publishedAt: DateTime.utc().plus({ days: 1 }),
    })
    await publish('page', 'about', { title: 'About page' })

    const listing = await client.get('/posts')
    const html = listing.text()

    assert.include(html, 'Live post')
    for (const hidden of ['Draft post', 'Archived post', 'Future post', 'About page']) {
      assert.notInclude(html, hidden)
    }
  })

  test('ten posts a page, newest first, stable when dates tie', async ({ client, assert }) => {
    const sameMoment = DateTime.utc().minus({ days: 1 })

    for (let i = 1; i <= 25; i++) {
      await publish('post', `post-${i}`, {
        title: `Post number ${i}`,
        publishedAt: i <= 5 ? sameMoment : sameMoment.plus({ minutes: i }),
      })
    }

    const count = (html: string) => (html.match(/class="post-list-item"/g) ?? []).length

    const one = await client.get('/posts')
    const two = await client.get('/posts?page=2')
    const three = await client.get('/posts?page=3')

    assert.equal(count(one.text()), 10)
    assert.equal(count(two.text()), 10)
    assert.equal(count(three.text()), 5)

    assert.include(one.text(), 'Post number 25')
    assert.include(three.text(), 'Post number 1<')

    /**
     * Posts 1–5 share a timestamp; the id tie-breaker orders them the same
     * way on every load. Compared by title order, because the page itself
     * carries a fresh CSRF token and nonce each time.
     */
    const titles = (html: string) => [...html.matchAll(/Post number (\d+)/g)].map((m) => m[1])
    const again = await client.get('/posts?page=3')
    assert.deepEqual(titles(three.text()), ['5', '4', '3', '2', '1'])
    assert.deepEqual(titles(again.text()), titles(three.text()))
  })

  test('past the last page is a 404; an empty blog is not', async ({ client }) => {
    const empty = await client.get('/posts')
    empty.assertStatus(200)
    empty.assertTextIncludes('Nothing published yet')

    await publish('post', 'only-one')

    const beyond = await client.get('/posts?page=2')
    beyond.assertStatus(404)
  })

  test('a nonsense page number goes back to the first page', async ({ client }) => {
    const response = await client.get('/posts?page=abc').redirects(0)

    response.assertStatus(302)
    response.assertHeader('location', '/posts')
  })

  test('pagination marks the current page for assistive tech', async ({ client, assert }) => {
    for (let i = 1; i <= 11; i++) {
      await publish('post', `p-${i}`)
    }

    const second = await client.get('/posts?page=2')
    const html = second.text()

    assert.match(html, /aria-label="Page 2"\s+aria-current=page/)
  })

  test('a live post renders with its metadata', async ({ client, assert }) => {
    await publish('post', 'hello', {
      title: 'Hello world',
      excerpt: 'The first post.',
      body: '## Heading\n\nSome **bold** text.',
    })

    const response = await client.get('/posts/hello')

    response.assertStatus(200)
    const html = response.text()
    assert.include(html, '<h2>Heading</h2>')
    assert.include(html, '<strong>bold</strong>')
    assert.include(html, '<meta name="description" content="The first post."')
    assert.match(html, /<link rel="canonical" href="[^"]*\/posts\/hello"/)
    assert.include(html, '<meta property="og:type" content="article"')
  })

  test('drafts, archives and scheduled posts are 404', async ({ client }) => {
    await publish('post', 'draft', { status: 'draft', publishedAt: null })
    await publish('post', 'archived', { status: 'archived' })
    await publish('post', 'later', { publishedAt: DateTime.utc().plus({ days: 1 }) })

    for (const slug of ['draft', 'archived', 'later', 'never-existed']) {
      const response = await client.get(`/posts/${slug}`)
      response.assertStatus(404)
    }
  })

  test('a page lives at the root and nowhere in the listing', async ({ client, assert }) => {
    await publish('page', 'about', { title: 'About us', body: 'Who we are.' })

    const page = await client.get('/about')
    page.assertStatus(200)
    page.assertTextIncludes('Who we are.')

    const listing = await client.get('/posts')
    assert.notInclude(listing.text(), 'About us')

    const asPost = await client.get('/posts/about')
    asPost.assertStatus(404)
  })

  test('a post is not reachable at the root', async ({ client }) => {
    await publish('post', 'news')

    const response = await client.get('/news')

    response.assertStatus(404)
  })

  /**
   * The routing-order guarantee (D13): `/:slug` never answers for a path a
   * real route owns, even when a page somehow holds that slug.
   */
  test('a core route always wins over a page with the same slug', async ({ client, assert }) => {
    await publish('page', 'login', { title: 'Impostor', body: 'Not the login page' })

    const response = await client.get('/login')

    response.assertStatus(200)
    assert.notInclude(response.text(), 'Not the login page')
  })

  test('an old slug 301s to wherever the entry lives now', async ({ client }) => {
    const post = await publish('post', 'new-name')
    await ContentSlugRedirect.create({ oldSlug: 'old-name', contentEntryId: post.id })
    const page = await publish('page', 'about-us')
    await ContentSlugRedirect.create({ oldSlug: 'about', contentEntryId: page.id })

    const movedPost = await client.get('/posts/old-name').redirects(0)
    movedPost.assertStatus(301)
    movedPost.assertHeader('location', '/posts/new-name')

    const movedPage = await client.get('/about').redirects(0)
    movedPage.assertStatus(301)
    movedPage.assertHeader('location', '/about-us')
  })

  test('a redirect to something not public is a 404, not a hint', async ({ client }) => {
    const draft = await publish('post', 'secret-new', { status: 'draft', publishedAt: null })
    await ContentSlugRedirect.create({ oldSlug: 'secret-old', contentEntryId: draft.id })

    const response = await client.get('/posts/secret-old').redirects(0)

    response.assertStatus(404)
  })

  test('stored script never reaches the public page', async ({ client, assert }) => {
    await publish('page', 'xss', {
      title: '<script>alert("title")</script>',
      body: '<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n<img src=x onerror=alert(1)>',
    })

    const response = await client.get('/xss')
    const html = response.text()

    assert.notInclude(html, '<script>alert')
    assert.notInclude(html, 'onerror=alert(1)>')
    assert.notMatch(html, /href="javascript:/i)
  })

  test('the marketing header links to the blog', async ({ client }) => {
    const response = await client.get('/posts')

    response.assertTextIncludes('href="/posts"')
  })
})
