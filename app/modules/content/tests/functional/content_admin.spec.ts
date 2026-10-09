import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import AuditLog from '#models/audit_log'
import ContentEntry from '#modules/content/models/content_entry'
import ContentSlugRedirect from '#modules/content/models/content_slug_redirect'
import { createStaff, createWorkspace } from '#tests/helpers'

/**
 * Admin → Content (plan §22.6).
 */
test.group('Content — back-office', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  const post = { title: 'Launch day', body: 'We are **live**.', excerpt: 'It shipped.' }

  test('an admin can create a post as a draft', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })

    const response = await client
      .post('/admin/content/posts')
      .withGuard('staff')
      .loginAs(admin)
      .form(post)
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)

    const entry = await ContentEntry.findByOrFail('slug', 'launch-day')
    assert.equal(entry.type, 'post')
    assert.equal(entry.status, 'draft')
    assert.isNull(entry.publishedAt)
    assert.equal(entry.excerpt, 'It shipped.')
    assert.equal(entry.createdByStaffId, admin.id)
    assert.match(entry.publicId, /^cnt_/)
    assert.exists(await AuditLog.findBy('action', 'content.created'))
  })

  test('save and publish does both, and audits both', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })

    await client
      .post('/admin/content/posts')
      .withGuard('staff')
      .loginAs(admin)
      .form({ ...post, intent: 'publish' })
      .withCsrfToken()
      .redirects(0)

    const entry = await ContentEntry.findByOrFail('slug', 'launch-day')
    assert.equal(entry.status, 'published')
    assert.isNotNull(entry.publishedAt)
    assert.exists(await AuditLog.findBy('action', 'content.published'))
  })

  test('support can neither see nor write content', async ({ client, assert }) => {
    const support = await createStaff({ role: 'support' })

    const page = await client.get('/admin/content/posts').withGuard('staff').loginAs(support)
    page.assertStatus(403)

    const write = await client
      .post('/admin/content/posts')
      .withGuard('staff')
      .loginAs(support)
      .form(post)
      .withCsrfToken()
      .redirects(0)

    write.assertStatus(302)
    assert.lengthOf(await ContentEntry.all(), 0)

    const sidebar = await client.get('/admin').withGuard('staff').loginAs(support)
    assert.notInclude(sidebar.text(), '/admin/content/posts')
  })

  test('a tenant user cannot reach it', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/admin/content/posts').loginAs(user).redirects(0)

    response.assertHeader('location', '/admin/login')
  })

  test('a blank slug is made from the title and disambiguated', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })

    for (const type of ['posts', 'pages']) {
      await client
        .post(`/admin/content/${type}`)
        .withGuard('staff')
        .loginAs(admin)
        .form({ title: 'About', body: 'x' })
        .withCsrfToken()
        .redirects(0)
    }

    const entries = await ContentEntry.query().orderBy('id')
    const slugs = entries.map((entry) => entry.slug)
    assert.deepEqual(slugs, ['about', 'about-2'])
  })

  test('a title that slugifies to a route gets a free slug instead', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })

    await client
      .post('/admin/content/pages')
      .withGuard('staff')
      .loginAs(admin)
      .form({ title: 'Login', body: 'x' })
      .withCsrfToken()
      .redirects(0)

    const entry = await ContentEntry.firstOrFail()
    assert.equal(entry.slug, 'login-2')
  })

  for (const slug of ['login', 'admin', 'api', 'posts', 'signup', 'assets']) {
    test(`a chosen slug of "${slug}" is refused`, async ({ client, assert }) => {
      const admin = await createStaff({ role: 'admin' })

      const response = await client
        .post('/admin/content/pages')
        .withGuard('staff')
        .loginAs(admin)
        .form({ title: 'Anything', slug, body: 'x' })
        .withCsrfToken()
        .redirects(0)

      response.assertStatus(302)
      response.assertFlashMessage('errorsBag', undefined)
      assert.lengthOf(await ContentEntry.all(), 0)
    })
  }

  test('a malformed slug is refused', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })

    for (const slug of ['Has Spaces', '../etc', 'trailing-', 'a/b']) {
      await client
        .post('/admin/content/pages')
        .withGuard('staff')
        .loginAs(admin)
        .form({ title: 'Anything', slug, body: 'x' })
        .withCsrfToken()
        .redirects(0)
    }

    assert.lengthOf(await ContentEntry.all(), 0)
  })

  test('a slug already used by the other type is refused', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    await ContentEntry.create({
      type: 'post',
      title: 'X',
      slug: 'taken',
      body: 'x',
      status: 'draft',
    })

    await client
      .post('/admin/content/pages')
      .withGuard('staff')
      .loginAs(admin)
      .form({ title: 'Y', slug: 'taken', body: 'x' })
      .withCsrfToken()
      .redirects(0)

    assert.lengthOf(await ContentEntry.all(), 1)
  })

  test('renaming a published entry leaves a redirect; a draft leaves none', async ({
    client,
    assert,
  }) => {
    const admin = await createStaff({ role: 'admin' })
    const live = await ContentEntry.create({
      type: 'post',
      title: 'Old',
      slug: 'old-name',
      body: 'x',
      status: 'published',
      publishedAt: DateTime.utc().minus({ days: 1 }),
    })
    const draft = await ContentEntry.create({
      type: 'post',
      title: 'Draft',
      slug: 'draft-name',
      body: 'x',
      status: 'draft',
    })

    for (const [entry, slug] of [
      [live, 'new-name'],
      [draft, 'draft-renamed'],
    ] as const) {
      await client
        .post(`/admin/content/entries/${entry.publicId}`)
        .withGuard('staff')
        .loginAs(admin)
        .form({ title: entry.title, slug, body: 'x' })
        .withCsrfToken()
        .redirects(0)
    }

    const redirects = await ContentSlugRedirect.all()
    assert.lengthOf(redirects, 1)
    assert.equal(redirects[0].oldSlug, 'old-name')
    assert.equal(redirects[0].contentEntryId, live.id)
  })

  test('nobody else can take a slug that still redirects', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    const live = await ContentEntry.create({
      type: 'page',
      title: 'About',
      slug: 'about-us',
      body: 'x',
      status: 'published',
      publishedAt: DateTime.utc().minus({ days: 1 }),
    })
    await ContentSlugRedirect.create({ oldSlug: 'about', contentEntryId: live.id })

    await client
      .post('/admin/content/pages')
      .withGuard('staff')
      .loginAs(admin)
      .form({ title: 'Other', slug: 'about', body: 'x' })
      .withCsrfToken()
      .redirects(0)

    assert.lengthOf(await ContentEntry.all(), 1)
  })

  test('editing without touching the slug keeps it, even if the title changes', async ({
    client,
    assert,
  }) => {
    const admin = await createStaff({ role: 'admin' })
    const entry = await ContentEntry.create({
      type: 'page',
      title: 'Terms',
      slug: 'terms-of-service',
      body: 'x',
      status: 'draft',
    })

    await client
      .post(`/admin/content/entries/${entry.publicId}`)
      .withGuard('staff')
      .loginAs(admin)
      .form({ title: 'Completely different', body: 'y' })
      .withCsrfToken()
      .redirects(0)

    await entry.refresh()
    assert.equal(entry.slug, 'terms-of-service')
    assert.equal(entry.title, 'Completely different')
  })

  test('publish keeps the first date; unpublish keeps it; republish keeps it', async ({
    client,
    assert,
  }) => {
    const admin = await createStaff({ role: 'admin' })
    const entry = await ContentEntry.create({
      type: 'post',
      title: 'Dates',
      slug: 'dates',
      body: 'x',
      status: 'draft',
    })

    const act = (action: string) =>
      client
        .post(`/admin/content/entries/${entry.publicId}/${action}`)
        .withGuard('staff')
        .loginAs(admin)
        .withCsrfToken()
        .redirects(0)

    await act('publish')
    await entry.refresh()
    const first = entry.publishedAt!.toMillis()

    await act('unpublish')
    await entry.refresh()
    assert.equal(entry.status, 'draft')
    assert.equal(entry.publishedAt!.toMillis(), first)

    await act('publish')
    await entry.refresh()
    assert.equal(entry.status, 'published')
    assert.equal(entry.publishedAt!.toMillis(), first)

    await act('archive')
    await entry.refresh()
    assert.equal(entry.status, 'archived')

    const logs = await AuditLog.query().orderBy('id')
    const actions = logs.map((log) => log.action)
    assert.deepEqual(actions, [
      'content.published',
      'content.unpublished',
      'content.published',
      'content.archived',
    ])
  })

  test('a refused transition is a flash, not a 500', async ({ client }) => {
    const admin = await createStaff({ role: 'admin' })
    const entry = await ContentEntry.create({
      type: 'post',
      title: 'X',
      slug: 'x',
      body: 'x',
      status: 'draft',
    })

    const response = await client
      .post(`/admin/content/entries/${entry.publicId}/unpublish`)
      .withGuard('staff')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'Only something published can be unpublished.')
  })

  test('delete removes the entry and its redirects', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    const entry = await ContentEntry.create({
      type: 'post',
      title: 'Gone',
      slug: 'gone',
      body: 'x',
      status: 'archived',
    })
    await ContentSlugRedirect.create({ oldSlug: 'was-here', contentEntryId: entry.id })

    await client
      .post(`/admin/content/entries/${entry.publicId}/delete`)
      .withGuard('staff')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)

    assert.lengthOf(await ContentEntry.all(), 0)
    assert.lengthOf(await ContentSlugRedirect.all(), 0)
    assert.exists(await AuditLog.findBy('action', 'content.deleted'))
  })

  test('preview shows a draft to an admin, rendered safely', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    const entry = await ContentEntry.create({
      type: 'page',
      title: 'Secret',
      slug: 'secret',
      body: 'Draft text <script>alert(1)</script>',
      status: 'draft',
    })

    const response = await client
      .get(`/admin/content/entries/${entry.publicId}/preview`)
      .withGuard('staff')
      .loginAs(admin)

    response.assertStatus(200)
    response.assertTextIncludes('Draft text')
    response.assertTextIncludes('Only staff can see this page')
    assert.notInclude(response.text(), '<script>alert(1)</script>')
  })

  test('the list filters by status', async ({ client, assert }) => {
    const admin = await createStaff({ role: 'admin' })
    await ContentEntry.create({
      type: 'post',
      title: 'Draft one',
      slug: 'a',
      body: 'x',
      status: 'draft',
    })
    await ContentEntry.create({
      type: 'post',
      title: 'Live one',
      slug: 'b',
      body: 'x',
      status: 'published',
      publishedAt: DateTime.utc(),
    })
    await ContentEntry.create({
      type: 'page',
      title: 'A page',
      slug: 'c',
      body: 'x',
      status: 'draft',
    })

    const drafts = await client
      .get('/admin/content/posts?status=draft')
      .withGuard('staff')
      .loginAs(admin)

    assert.include(drafts.text(), 'Draft one')
    assert.notInclude(drafts.text(), 'Live one')
    assert.notInclude(drafts.text(), 'A page', 'pages are not on the posts screen')
  })
})
