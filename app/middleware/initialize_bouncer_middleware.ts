import * as abilities from '#abilities/main'
import { policies } from '#generated/policies'

import { Bouncer } from '@adonisjs/bouncer'
import type User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Init bouncer middleware is used to create a bouncer instance
 * during an HTTP request
 */
export default class InitializeBouncerMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    /**
     * The actor is the tenant user, taken from the `web` guard specifically.
     *
     * `ctx.auth.user` spans every configured guard, which since M1 means
     * `User | StaffUser` — and a policy method written against `User` does
     * not satisfy that union, so every policy would silently drop out of the
     * type-level action list. Staff authorisation is its own guard, its own
     * table and (from M7) its own policies; conflating the two here is
     * exactly the leak D5 exists to prevent.
     */
    ctx.bouncer = new Bouncer(
      (): User | null => ctx.auth.use('web').user ?? null,
      abilities,
      policies
    ).setContainerResolver(ctx.containerResolver)

    /**
     * Share bouncer helpers with Edge templates.
     */
    if ('view' in ctx) {
      ctx.view.share(ctx.bouncer.edgeHelpers)
    }

    return next()
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    bouncer: Bouncer<User, typeof abilities, typeof policies>
  }
}
