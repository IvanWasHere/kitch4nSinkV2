import router from '@adonisjs/core/services/router'
import { Exception } from '@adonisjs/core/exceptions'
import type { HttpContext } from '@adonisjs/core/http'

import type { FeatureKey } from '#config/plans'

/**
 * A feature the organisation's plan does not include (plan §7.3).
 *
 * Distinct from a count limit: there is no usage to report and no "you are at
 * 25 of 3" to render — the answer is that this plan does not have the feature
 * at all, and the screen for it is hidden rather than shown empty.
 */
export default class UpgradeRequiredException extends Exception {
  static status = 402
  static code = 'E_UPGRADE_REQUIRED'

  constructor(readonly feature: FeatureKey | string) {
    super(`Your plan does not include ${feature}.`, {
      status: UpgradeRequiredException.status,
      code: UpgradeRequiredException.code,
    })
  }

  get upgradeUrl(): string {
    return router.find('billing.index') ? router.makeUrl('billing.index') : '/billing'
  }

  async handle(error: this, ctx: HttpContext) {
    if (ctx.request.accepts(['html', 'json']) === 'json') {
      return ctx.response.status(402).send({
        error: {
          code: 'upgrade_required',
          message: error.message,
          feature: error.feature,
          upgradeUrl: error.upgradeUrl,
        },
      })
    }

    ctx.session.flash('error', error.message)
    return ctx.response.redirect().toPath(error.upgradeUrl)
  }
}
