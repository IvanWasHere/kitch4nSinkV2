import { DateTime } from 'luxon'
import { errors as vineErrors } from '@vinejs/vine'
import type { HttpContext } from '@adonisjs/core/http'

import env from '#start/env'
import audit, { type AuditAction } from '#audit/audit_service'
import type StaffUser from '#models/staff_user'
import type ContentEntry from '#modules/content/models/content_entry'
import { contentValidator } from '#modules/content/validators'
import { plainText, renderMarkdown } from '#modules/content/services/renderer'
import content, {
  CONTENT_STATUSES,
  ContentError,
  type ContentInput,
  type ContentStatus,
  type ContentType,
} from '#modules/content/services/content_service'
import '#modules/content/audit_actions'

/**
 * `posts` and `pages` in a URL, `post` and `page` in the table.
 */
const TYPES: Record<string, ContentType> = { posts: 'post', pages: 'page' }

/**
 * Admin → Content (plan §22.6). Admin only, through
 * `StaffPolicy.editPublicSite`: whatever is written here is published under
 * the company's name.
 */
export default class ContentController {
  async index({ params, request, view, staffBouncer, response }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('editPublicSite')

    const type = TYPES[params.type]
    if (!type) {
      return response.notFound()
    }

    const requested = String(request.input('status', ''))
    const status = (CONTENT_STATUSES as readonly string[]).includes(requested)
      ? (requested as ContentStatus)
      : null
    const page = Math.max(1, Number.parseInt(String(request.input('page', 1)), 10) || 1)

    const [entries, counts, shadowed] = await Promise.all([
      content.page({ type, status, page }),
      content.counts(type),
      type === 'page' ? content.shadowedPages() : Promise.resolve([]),
    ])

    const query = (target: number) =>
      `?${new URLSearchParams({ ...(status ? { status } : {}), page: String(target) })}`

    return view.render('pages/content/admin/index', {
      type,
      typeParam: params.type,
      entries: entries.all(),
      counts,
      status,
      statuses: CONTENT_STATUSES,
      prevUrl: entries.currentPage > 1 ? query(entries.currentPage - 1) : null,
      nextUrl: entries.hasMorePages ? query(entries.currentPage + 1) : null,
      summary: entries.total ? `${entries.total} in total` : '',
      shadowed,
    })
  }

  async create({ params, view, staffBouncer, response }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('editPublicSite')

    const type = TYPES[params.type]
    if (!type) {
      return response.notFound()
    }

    return view.render('pages/content/admin/form', { type, typeParam: params.type, entry: null })
  }

  async store(ctx: HttpContext) {
    const { params, request, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('editPublicSite')

    const type = TYPES[params.type]
    if (!type) {
      return response.notFound()
    }

    const input = await this.input(ctx)
    const staff = auth.use('staff').user!
    const entry = await content.create(type, input, staff)

    await this.record(ctx, 'content.created', entry)

    if (request.input('intent') === 'publish') {
      await content.publish(entry, staff)
      await this.record(ctx, 'content.published', entry)
      session.flash('success', `Published "${entry.title}".`)
    } else {
      session.flash('success', `Saved "${entry.title}" as a draft.`)
    }

    return response.redirect().toRoute('admin.content.edit', { id: entry.publicId })
  }

  async edit({ params, view, staffBouncer, response, session }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('editPublicSite')

    const entry = await content.findByPublicId(params.id)
    if (!entry) {
      session.flash('error', 'That entry no longer exists.')
      return response.redirect().toRoute('admin.content.index', { type: 'posts' })
    }

    return view.render('pages/content/admin/form', {
      type: entry.type,
      typeParam: entry.isPost ? 'posts' : 'pages',
      entry,
      publicUrl: `${env.get('APP_URL')}${entry.path}`,
    })
  }

  async update(ctx: HttpContext) {
    const { params, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('editPublicSite')

    const entry = await content.findByPublicId(params.id)
    if (!entry) {
      session.flash('error', 'That entry no longer exists.')
      return response.redirect().toRoute('admin.content.index', { type: 'posts' })
    }

    const previousSlug = entry.slug
    await content.update(entry, await this.input(ctx), auth.use('staff').user!)
    await this.record(ctx, 'content.updated', entry, { previousSlug })

    session.flash('success', `Saved "${entry.title}".`)
    return response.redirect().toRoute('admin.content.edit', { id: entry.publicId })
  }

  async publish(ctx: HttpContext) {
    return this.transition(ctx, 'content.published', (entry, staff) =>
      content.publish(entry, staff)
    )
  }

  async unpublish(ctx: HttpContext) {
    return this.transition(ctx, 'content.unpublished', (entry, staff) =>
      content.unpublish(entry, staff)
    )
  }

  async archive(ctx: HttpContext) {
    return this.transition(ctx, 'content.archived', (entry, staff) => content.archive(entry, staff))
  }

  async destroy(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('editPublicSite')

    const entry = await content.findByPublicId(params.id)
    if (!entry) {
      session.flash('error', 'That entry no longer exists.')
      return response.redirect().toRoute('admin.content.index', { type: 'posts' })
    }

    const typeParam = entry.isPost ? 'posts' : 'pages'
    await this.record(ctx, 'content.deleted', entry)
    await content.delete(entry)

    session.flash('success', `Deleted "${entry.title}".`)
    return response.redirect().toRoute('admin.content.index', { type: typeParam })
  }

  /**
   * The entry as the public would see it, whatever its status — the only way
   * to read a draft in the site's own layout before publishing it.
   */
  async preview({ params, view, staffBouncer, response }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('editPublicSite')

    const entry = await content.findByPublicId(params.id)
    if (!entry) {
      return response.notFound()
    }

    return view.render('pages/content/public/show', {
      entry,
      html: renderMarkdown(entry.body),
      description: entry.excerpt || plainText(entry.body),
      canonical: null,
      preview: true,
    })
  }

  private async transition(
    ctx: HttpContext,
    action: AuditAction,
    run: (entry: ContentEntry, staff: StaffUser) => Promise<void>
  ) {
    const { params, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('editPublicSite')

    const entry = await content.findByPublicId(params.id)
    if (!entry) {
      session.flash('error', 'That entry no longer exists.')
      return response.redirect().back()
    }

    try {
      await run(entry, auth.use('staff').user!)
    } catch (error) {
      if (error instanceof ContentError) {
        session.flash('error', error.message)
        return response.redirect().back()
      }

      throw error
    }

    await this.record(ctx, action, entry)

    session.flash('success', `"${entry.title}" is now ${entry.status}.`)
    return response.redirect().back()
  }

  private async record(
    ctx: HttpContext,
    action: AuditAction,
    entry: ContentEntry,
    extra: Record<string, unknown> = {}
  ) {
    await audit.recordStaffAction(ctx, {
      action,
      subjectType: 'ContentEntry',
      subjectId: entry.publicId,
      metadata: {
        type: entry.type,
        title: entry.title,
        slug: entry.slug,
        status: entry.status,
        ...extra,
      },
    })
  }

  /**
   * The form, validated and turned into what the service takes. The date is
   * a `datetime-local` value read as UTC; anything that does not parse is a
   * field error rather than a silent "now".
   */
  private async input({ request }: HttpContext): Promise<ContentInput> {
    const payload = await request.validateUsing(contentValidator)

    let publishedAt: DateTime | null = null

    if (payload.publishedAt) {
      publishedAt = DateTime.fromISO(payload.publishedAt, { zone: 'utc' })

      if (!publishedAt.isValid) {
        throw new vineErrors.E_VALIDATION_ERROR([
          { field: 'publishedAt', rule: 'date', message: 'Enter a valid date and time.' },
        ])
      }
    }

    return {
      title: payload.title,
      slug: payload.slug ?? null,
      excerpt: payload.excerpt ?? null,
      body: payload.body,
      publishedAt,
    }
  }
}
