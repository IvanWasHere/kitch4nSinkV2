import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'

import { ContentEntrySchema } from '#database/schema'
import { withPublicId } from '#models/mixins/with_public_id'

/**
 * A post or a page (plan §22.6).
 *
 * Posts are listed at `/posts` and live at `/posts/:slug`; pages are never
 * listed and live at `/:slug`. Everything else about them is the same, which
 * is why they share a table.
 *
 *   draft ⇄ published → archived → draft
 *
 * Published means *visible* only once `published_at` has passed, which is how
 * a post is scheduled.
 */
export default class ContentEntry extends compose(
  ContentEntrySchema,
  withPublicId('contentEntry')
) {
  get isPost() {
    return this.type === 'post'
  }

  get isLive() {
    return (
      this.status === 'published' &&
      Boolean(this.publishedAt) &&
      this.publishedAt! <= DateTime.utc()
    )
  }

  get isScheduled() {
    return (
      this.status === 'published' && Boolean(this.publishedAt) && this.publishedAt! > DateTime.utc()
    )
  }

  /**
   * Where the public finds it. Built from the slug rather than by route name
   * so a draft — which has no public route that would answer — still has an
   * address to show in the admin.
   */
  get path() {
    return this.isPost ? `/posts/${this.slug}` : `/${this.slug}`
  }
}
