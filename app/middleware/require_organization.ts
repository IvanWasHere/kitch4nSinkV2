import router from '@adonisjs/core/services/router'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import plans from '#billing/plan_service'
import Organization from '#models/organization'
import notifications from '#notifications/notification_service'
import support from '#support/support_service'

/**
 * Loads the signed-in user's organisation onto the context and shares it with
 * Edge, so the shell can render the workspace name, the owner-only nav items,
 * the plan usage meters and the unread notification dot without every
 * controller fetching them.
 *
 * Every user belongs to exactly one organisation (D1). A missing one means
 * the row was deleted underneath the session, which is a sign-out, not a 500.
 */
export default class RequireOrganizationMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.use('web').user!

    const organization = await Organization.query()
      .where('id', user.organizationId)
      .whereNull('deleted_at')
      .first()

    if (!organization) {
      await ctx.auth.use('web').logout()
      ctx.session.flash('error', 'That workspace is no longer available.')
      return ctx.response.redirect().toRoute('auth.session.create')
    }

    if (organization.isSuspended) {
      await ctx.auth.use('web').logout()
      ctx.session.flash('error', 'That workspace has been suspended. Contact support.')
      return ctx.response.redirect().toRoute('auth.session.create')
    }

    ctx.organization = organization

    if ('view' in ctx) {
      /**
       * Usage is shared with every rendered page because the sidebar shows it
       * on every one (plan §13.6.1) — two counts per request, against indexed
       * `organization_id` columns. Computing it here rather than in each
       * controller is also what guarantees the nav counter, the meter and the
       * disabled *Add list* button are the same numbers as enforcement.
       */
      const [usage, unreadNotifications, awaitingSupportReplies] = await Promise.all([
        plans.usage(organization),
        /**
         * The red dot, on every screen (plan §20.5). Narrowed by the user's
         * `notifications_seen_at` first, so for somebody who looks regularly
         * this is an empty result and the audience filter never runs.
         */
        notifications.unreadCountFor(user, organization),
        /**
         * The count beside *Support* in the account menu (plan §21.7): the
         * user's tickets that staff have answered and they have not come
         * back to. One indexed count, from the status — there is no
         * `seen_at` column behind it.
         */
        support.awaitingCustomerCount(organization, user),
      ])

      ctx.view.share({
        organization,
        isOwner: user.isOwner,
        usage,
        unreadNotifications,
        awaitingSupportReplies,

        /**
         * Where the profile row in the sidebar leads: the feed when there is
         * something new, the profile otherwise.
         *
         * Derived here rather than in the template because Edge's `@let` does
         * not scope reliably inside a nested block, and because a shell with
         * no logic of its own is a shell that cannot get this wrong on one
         * screen and right on another.
         */
        notificationsUrl:
          unreadNotifications > 0 && router.find('notifications.index')
            ? router.makeUrl('notifications.index')
            : null,
      })
    }

    return next()
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    organization: Organization
  }
}
