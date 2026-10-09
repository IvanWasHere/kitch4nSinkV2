import { DateTime } from 'luxon'
import { errors as vineErrors } from '@vinejs/vine'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import type StaffUser from '#models/staff_user'
import ContentEntry from '#modules/content/models/content_entry'
import ContentSlugRedirect from '#modules/content/models/content_slug_redirect'
import { isReservedSlug, slugify } from '#modules/content/services/slugs'

export type ContentType = ContentEntry['type']
export type ContentStatus = ContentEntry['status']

export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const

/**
 * Exactly ten, per the PRD — the listing is the one number on the public site
 * somebody asked for by name.
 */
export const POSTS_PER_PAGE = 10

export interface ContentInput {
  title: string
  /**
   * Blank means "make one from the title".
   */
  slug?: string | null
  excerpt?: string | null
  body: string
  /**
   * Only posts carry a chosen date. Null leaves it to publishing to stamp.
   */
  publishedAt?: DateTime | null
}

/**
 * A refused status change — shown to the admin as-is.
 */
export class ContentError extends Error {}

/**
 * Posts and pages (plan §22.6).
 *
 * Everything that decides whether something is *public* lives here, so the
 * rule "published, and its date has come" is written once and the admin
 * screens, the public listing and the page route cannot disagree about it.
 */
export class ContentService {
  /**
   * The admin list: one type, optionally one status, newest edit first.
   */
  async page(filters: { type: ContentType; status: ContentStatus | null; page: number }) {
    const query = ContentEntry.query()
      .where('type', filters.type)
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')

    if (filters.status) {
      query.where('status', filters.status)
    }

    return query.paginate(filters.page, 50)
  }

  async counts(type: ContentType): Promise<Record<ContentStatus | 'all', number>> {
    const rows = await ContentEntry.query()
      .where('type', type)
      .select('status')
      .count('* as total')
      .groupBy('status')

    const counts = { all: 0, draft: 0, published: 0, archived: 0 }

    for (const row of rows) {
      const total = Number(row.$extras.total)
      counts[row.status] = total
      counts.all += total
    }

    return counts
  }

  async findByPublicId(publicId: string): Promise<ContentEntry | null> {
    return ContentEntry.findBy('public_id', publicId)
  }

  /**
   * New entries are always drafts. Publishing is its own, separately audited
   * step, so "who put this live?" has one answer.
   */
  async create(type: ContentType, input: ContentInput, staff: StaffUser): Promise<ContentEntry> {
    return db.transaction(async (trx) => {
      const slug = await this.resolveSlug(input.slug, input.title, null, trx)

      return ContentEntry.create(
        {
          type,
          title: input.title,
          slug,
          excerpt: type === 'post' ? (input.excerpt ?? null) : null,
          body: input.body,
          status: 'draft',
          publishedAt: type === 'post' ? (input.publishedAt ?? null) : null,
          createdByStaffId: staff.id,
          updatedByStaffId: staff.id,
        },
        { client: trx }
      )
    })
  }

  /**
   * Edit an entry. Changing the slug of anything that has ever been public
   * leaves the old one behind as a redirect, so shared links keep working.
   */
  async update(entry: ContentEntry, input: ContentInput, staff: StaffUser): Promise<ContentEntry> {
    return db.transaction(async (trx) => {
      const slug = await this.resolveSlug(input.slug, input.title, entry, trx)

      if (slug !== entry.slug) {
        /**
         * Taking back a slug this entry used to have: the redirect pointing
         * it at itself has nothing left to do.
         */
        await ContentSlugRedirect.query({ client: trx })
          .where('old_slug', slug)
          .where('content_entry_id', entry.id)
          .delete()

        if (entry.publishedAt) {
          await ContentSlugRedirect.create(
            { oldSlug: entry.slug, contentEntryId: entry.id },
            { client: trx }
          )
        }
      }

      entry.useTransaction(trx)
      entry.merge({
        title: input.title,
        slug,
        excerpt: entry.isPost ? (input.excerpt ?? null) : null,
        body: input.body,
        updatedByStaffId: staff.id,
      })

      /**
       * The date can be changed while the post is not live — a draft, or a
       * scheduled post whose date has not come. Once readers can see it, the
       * date they saw is the date it keeps (plan §22.6).
       */
      if (entry.isPost && !entry.isLive && input.publishedAt !== undefined) {
        entry.publishedAt = input.publishedAt
      }

      await entry.save()
      return entry
    })
  }

  /**
   * Make it public. Stamps `published_at` only if it has none, so publishing
   * again after an unpublish keeps the original date, and a chosen future
   * date makes it a scheduled post.
   */
  async publish(entry: ContentEntry, staff: StaffUser): Promise<void> {
    if (entry.status === 'published') {
      throw new ContentError('That is already published.')
    }

    entry.status = 'published'
    entry.publishedAt = entry.publishedAt ?? DateTime.utc()
    entry.updatedByStaffId = staff.id
    await entry.save()

    logger.info(
      { event: 'content.published', entry: entry.publicId, type: entry.type },
      'published content'
    )
  }

  /**
   * Back to draft. Keeps `published_at`, so the entry's history — and its
   * date, if it goes back up — survives.
   */
  async unpublish(entry: ContentEntry, staff: StaffUser): Promise<void> {
    if (entry.status !== 'published') {
      throw new ContentError('Only something published can be unpublished.')
    }

    entry.status = 'draft'
    entry.updatedByStaffId = staff.id
    await entry.save()
  }

  async archive(entry: ContentEntry, staff: StaffUser): Promise<void> {
    if (entry.status === 'archived') {
      throw new ContentError('That is already archived.')
    }

    entry.status = 'archived'
    entry.updatedByStaffId = staff.id
    await entry.save()
  }

  /**
   * Remove it, and every old slug that pointed at it — a redirect to nothing
   * is a 301 into a 404.
   */
  async delete(entry: ContentEntry): Promise<void> {
    await db.transaction(async (trx) => {
      await ContentSlugRedirect.query({ client: trx }).where('content_entry_id', entry.id).delete()
      entry.useTransaction(trx)
      await entry.delete()
    })
  }

  /**
   * One page of the public listing: live posts only, newest first, with the
   * id as a tie-breaker so two posts published in the same second keep a
   * stable order between page loads.
   */
  async publishedPosts(page: number) {
    return this.live(ContentEntry.query().where('type', 'post'))
      .orderBy('published_at', 'desc')
      .orderBy('id', 'desc')
      .paginate(page, POSTS_PER_PAGE)
  }

  async livePost(slug: string): Promise<ContentEntry | null> {
    return this.live(ContentEntry.query().where('type', 'post').where('slug', slug)).first()
  }

  async livePage(slug: string): Promise<ContentEntry | null> {
    return this.live(ContentEntry.query().where('type', 'page').where('slug', slug)).first()
  }

  /**
   * Published pages that can no longer be reached because a route registered
   * since has taken their slug (plan §22.6). Saving refuses a reserved slug,
   * but a page saved before the route existed keeps it — and `/:slug` is
   * matched last, so the route wins and the page silently disappears.
   *
   * Pages only: a post lives under `/posts/`, which nothing else can take.
   */
  async shadowedPages(): Promise<ContentEntry[]> {
    const pages = await ContentEntry.query()
      .where('type', 'page')
      .where('status', 'published')
      .orderBy('slug')

    return pages.filter((page) => isReservedSlug(page.slug))
  }

  /**
   * Where an old slug points now — only if the entry it points at is live.
   * A redirect to a draft would announce that the draft exists.
   */
  async redirectFor(slug: string): Promise<ContentEntry | null> {
    const redirect = await ContentSlugRedirect.findBy('old_slug', slug)

    if (!redirect) {
      return null
    }

    return this.live(ContentEntry.query().where('id', redirect.contentEntryId)).first()
  }

  /**
   * The one definition of "public": published, and its date has come.
   */
  private live<Query extends ReturnType<typeof ContentEntry.query>>(query: Query): Query {
    return query
      .where('status', 'published')
      .whereNotNull('published_at')
      .where('published_at', '<=', DateTime.utc().toSQL()!) as Query
  }

  /**
   * Decide the slug for an entry.
   *
   * A slug the admin typed is checked and either accepted or refused with a
   * field error. A blank one is generated from the title and disambiguated
   * (`launch`, `launch-2`, …) without bothering anyone.
   */
  private async resolveSlug(
    requested: string | null | undefined,
    title: string,
    entry: ContentEntry | null,
    trx: TransactionClientContract
  ): Promise<string> {
    if (requested) {
      const problem = await this.slugProblem(requested, entry, trx)

      if (problem) {
        throw new vineErrors.E_VALIDATION_ERROR([{ field: 'slug', rule: 'slug', message: problem }])
      }

      return requested
    }

    /**
     * Editing without touching the slug keeps the one it has — a title
     * change must never quietly move a published page.
     */
    if (entry) {
      return entry.slug
    }

    const base = slugify(title)

    for (let attempt = 1; attempt < 100; attempt++) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`

      if (!(await this.slugProblem(candidate, null, trx))) {
        return candidate
      }
    }

    throw new vineErrors.E_VALIDATION_ERROR([
      {
        field: 'slug',
        rule: 'slug',
        message: 'Choose a slug — none could be made from the title.',
      },
    ])
  }

  private async slugProblem(
    slug: string,
    entry: ContentEntry | null,
    trx: TransactionClientContract
  ): Promise<string | null> {
    if (isReservedSlug(slug)) {
      return `"${slug}" is used by the application itself. Choose another slug.`
    }

    const taken = await ContentEntry.query({ client: trx })
      .where('slug', slug)
      .if(entry, (query) => query.whereNot('id', entry!.id))
      .first()

    if (taken) {
      return `Another ${taken.type} already uses "${slug}".`
    }

    const redirect = await ContentSlugRedirect.query({ client: trx })
      .where('old_slug', slug)
      .if(entry, (query) => query.whereNot('content_entry_id', entry!.id))
      .first()

    if (redirect) {
      return `"${slug}" used to belong to something else and still redirects there.`
    }

    return null
  }
}

export default new ContentService()
