import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

import Organization from '#models/organization'

/**
 * Loads the signed-in user's organisation onto the context and shares it with
 * Edge, so the shell can render the workspace name, the owner-only nav items
 * and (from M4) the usage meters without every controller fetching it.
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
      ctx.view.share({ organization, isOwner: user.isOwner })
    }

    return next()
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    organization: Organization
  }
}
