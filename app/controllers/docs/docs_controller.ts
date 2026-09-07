import type { HttpContext } from '@adonisjs/core/http'

import { openApiDocument } from '#api/openapi'

/**
 * The API documentation (plan §11).
 *
 * Public and unauthenticated: somebody evaluating whether to build against
 * this needs to read the docs *before* they have a key, and a spec behind a
 * login is a spec nobody reads.
 */
export default class DocsController {
  /**
   * The machine-readable document. Clients generate SDKs from this, so it is
   * served at a stable path with its own content type.
   */
  async openapi({ response }: HttpContext) {
    return response
      .header('content-type', 'application/json')
      .header('cache-control', 'public, max-age=300')
      .send(openApiDocument())
  }

  /**
   * The human page.
   *
   * Renders the spec with Scalar from a CDN. Deliberately not bundled: the
   * docs viewer is not part of the application, and shipping a megabyte of
   * someone else's JavaScript through our build to render a page most users
   * never open is a poor trade. The page degrades to a link to the raw
   * document if the CDN is unreachable.
   */
  async index({ view }: HttpContext) {
    return view.render('pages/docs/index')
  }
}
