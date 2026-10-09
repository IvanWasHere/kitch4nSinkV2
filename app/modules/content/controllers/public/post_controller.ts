import type { HttpContext } from '@adonisjs/core/http'

import env from '#start/env'
import content from '#modules/content/services/content_service'
import { plainText, renderMarkdown } from '#modules/content/services/renderer'

/**
 * The public blog (plan §22.6): `/posts`, ten at a time, and one post.
 */
export default class PostController {
  async index({ request, view, response }: HttpContext) {
    const raw = String(request.input('page', '1'))
    const page = /^\d+$/.test(raw) ? Number(raw) : Number.NaN

    if (!Number.isInteger(page) || page < 1) {
      /**
       * Without its query string — `config/app.ts` forwards it by default,
       * which here would loop straight back to the same bad page number.
       */
      return response.redirect().withQs(false).toRoute('posts.index')
    }

    const posts = await content.publishedPosts(page)

    /**
     * Past the last page is a 404, not an empty list: `/posts?page=40` on a
     * blog with three pages is a link that does not exist. Page one of an
     * empty blog is not — it is a blog with nothing in it yet.
     */
    if (page > 1 && page > posts.lastPage) {
      return response.notFound()
    }

    const pageUrl = (target: number) => (target === 1 ? '/posts' : `/posts?page=${target}`)

    return view.render('pages/content/public/posts', {
      posts: posts.all().map((post) => ({
        post,
        summary: post.excerpt || plainText(post.body, 240),
      })),
      page,
      lastPage: posts.lastPage,
      pages: Array.from({ length: posts.lastPage }, (_, index) => ({
        number: index + 1,
        url: pageUrl(index + 1),
      })),
      prevUrl: page > 1 ? pageUrl(page - 1) : null,
      nextUrl: posts.hasMorePages ? pageUrl(page + 1) : null,
      canonical: `${env.get('APP_URL')}${pageUrl(page)}`,
    })
  }

  async show({ params, view, response }: HttpContext) {
    const post = await content.livePost(params.slug)

    if (!post) {
      /**
       * An old slug moved permanently — and only if what it moved to is
       * public, so a redirect never reveals a draft.
       */
      const moved = await content.redirectFor(params.slug)
      return moved ? response.redirect().status(301).toPath(moved.path) : response.notFound()
    }

    return view.render('pages/content/public/show', {
      entry: post,
      html: renderMarkdown(post.body),
      description: post.excerpt || plainText(post.body),
      canonical: `${env.get('APP_URL')}${post.path}`,
      preview: false,
    })
  }
}
