import type { HttpContext } from '@adonisjs/core/http'

import notifications from '#notifications/notification_service'

/**
 * `/notifications` — the announcement feed (plan §20.5).
 *
 * Every member sees it: there is nothing owner-only about being told
 * something. What each person sees is decided by the audience predicate, not
 * by a policy.
 */
export default class NotificationController {
  async index({ view, auth, organization }: HttpContext) {
    const user = auth.use('web').user!

    /**
     * Read the feed **before** stamping, and stamp after — the "new since
     * your last visit" highlight is the difference between the two, so doing
     * it the other way round would mark everything old on the very page that
     * is meant to show it as new (plan §20.4).
     */
    const feed = await notifications.feedFor(user, organization)

    await notifications.markSeen(user)

    return view.render('pages/notifications/index', { feed })
  }
}
