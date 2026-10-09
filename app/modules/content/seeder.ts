import type { DemoSeeder } from '#seeding/demo_seeders'

/**
 * The Content module's share of `node ace dev:seed` (plan §22.6).
 *
 * Enough to see every state the admin screens show and to page through the
 * blog: twelve live posts (two pages of them), one scheduled, one draft, one
 * archived, and two pages. Registered in `start/seeders.ts`, so removing the
 * module takes its demo rows with it.
 *
 * No `privacy` or `terms` page: those belong to the Landing module (M14), and
 * a seeded page at a slug Landing later routes would show up as shadowed.
 */
export const contentDemoSeeder: DemoSeeder = {
  key: 'content',

  async seed() {
    const { DateTime } = await import('luxon')
    const { default: StaffUser } = await import('#models/staff_user')
    const { default: ContentEntry } = await import('#modules/content/models/content_entry')
    const { default: ContentSlugRedirect } =
      await import('#modules/content/models/content_slug_redirect')

    const author = await StaffUser.findBy('email', 'admin@example.com')
    const by = { createdByStaffId: author?.id ?? null, updatedByStaffId: author?.id ?? null }
    const now = DateTime.utc()

    const topics = [
      ['Introducing shared lists', 'Lists now belong to the whole workspace.'],
      ['Faster todo creation', 'We shaved the create path down to one query.'],
      ['Two-factor for everyone', 'Every plan can now require a second factor.'],
      ['The API is out of beta', 'Scoped keys, cursors and a stable error shape.'],
      ['Pro gets more lists', 'Twenty-five lists and ten seats, same price.'],
      ['Support, inside the app', 'Open a ticket without leaving your workspace.'],
      ['Usage meters', 'See how close you are to your plan, before you hit it.'],
      ['File uploads', 'Attach files to your workspace, checked on the way in.'],
      ['Announcements', 'We can now tell you about changes in the app itself.'],
      ['Postgres in production', 'The same code runs on SQLite locally and Postgres live.'],
      ['Audit everything', 'Every staff action now leaves a trail.'],
      ['Hello, world', 'The first post on the new blog.'],
    ] as const

    for (const [index, [title, excerpt]] of topics.entries()) {
      await ContentEntry.create({
        ...by,
        type: 'post',
        title,
        slug: title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        excerpt,
        body: `${excerpt}\n\n## What changed\n\nA short, **demo** post — written by \`dev:seed\` so the blog has something to page through.\n\n- One thing\n- Another thing\n\n> Quoted for emphasis.\n\nRead the [docs](/docs) for more.`,
        status: 'published',
        publishedAt: now.minus({ days: (topics.length - index) * 6 }),
      })
    }

    await ContentEntry.create({
      ...by,
      type: 'post',
      title: 'Coming next week',
      slug: 'coming-next-week',
      excerpt: 'Scheduled — it goes live on its own when the date comes.',
      body: 'This post is scheduled. Until its date it is listed in the admin but not on the blog.',
      status: 'published',
      publishedAt: now.plus({ days: 7 }),
    })

    await ContentEntry.create({
      ...by,
      type: 'post',
      title: 'Half-written thoughts',
      slug: 'half-written-thoughts',
      excerpt: null,
      body: 'A draft. Only staff can see it, through Preview.',
      status: 'draft',
    })

    await ContentEntry.create({
      ...by,
      type: 'post',
      title: 'Old pricing',
      slug: 'old-pricing',
      excerpt: 'Archived — kept, but off the site.',
      body: 'The prices this post described have changed.',
      status: 'archived',
      publishedAt: now.minus({ days: 200 }),
    })

    const about = await ContentEntry.create({
      ...by,
      type: 'page',
      title: 'About us',
      slug: 'about-us',
      body: '## Who we are\n\nA small team building a multi-tenant SaaS starter.\n\nThis page is reached at `/about-us` — and `/about`, its old address, still redirects here.',
      status: 'published',
      publishedAt: now.minus({ days: 90 }),
    })

    await ContentSlugRedirect.create({ oldSlug: 'about', contentEntryId: about.id })

    await ContentEntry.create({
      ...by,
      type: 'page',
      title: 'Contact',
      slug: 'contact',
      body: 'Email **hello@example.com**, or open a ticket from inside the app.',
      status: 'published',
      publishedAt: now.minus({ days: 90 }),
    })
  },
}
