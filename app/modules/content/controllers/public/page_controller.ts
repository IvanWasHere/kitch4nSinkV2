import type { HttpContext } from '@adonisjs/core/http'

import env from '#start/env'
import content from '#modules/content/services/content_service'
import { plainText, renderMarkdown } from '#modules/content/services/renderer'

/**
 * A page at `/:slug` (plan §22.6, D13). Matched after every other route, so
 * it only ever sees a path nothing else wanted.
 */
export default class PageController {
  async show({ params, view, response }: HttpContext) {
    const page = await content.livePage(params.slug)

    if (!page) {
      const moved = await content.redirectFor(params.slug)
      return moved ? response.redirect().status(301).toPath(moved.path) : response.notFound()
    }

    return view.render('pages/content/public/show', {
      entry: page,
      html: renderMarkdown(page.body),
      description: plainText(page.body),
      canonical: `${env.get('APP_URL')}${page.path}`,
      preview: false,
    })
  }
}
