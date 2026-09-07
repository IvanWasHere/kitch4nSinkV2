import type { HttpContext } from '@adonisjs/core/http'

import plans from '#billing/plan_service'
import usage from '#api/usage_service'
import apiKeys, { ApiKeyError } from '#api/api_key_service'
import { API_SCOPES, SCOPE_DESCRIPTIONS } from '#api/scopes'
import { createApiKeyValidator } from '#validators/api'

/**
 * The API Keys screen (plan §13.5, owner-only).
 *
 * A key is shown **once**, at creation, and we keep only its prefix and a
 * hash — so the screen has to say that plainly rather than let somebody
 * assume they can come back for it.
 */
export default class ApiKeyController {
  async index({ view, organization, bouncer }: HttpContext) {
    await bouncer.with('ApiKeyPolicy').authorize('viewAny', organization)

    const [keys, active, recent, monthly] = await Promise.all([
      apiKeys.forOrganization(organization),
      apiKeys.activeCount(organization),
      usage.recentDays(organization),
      usage.monthToDate(organization),
    ])

    return view.render('pages/api_keys/index', {
      keys,
      scopes: API_SCOPES.map((scope) => ({ value: scope, label: SCOPE_DESCRIPTIONS[scope] })),
      keyUsage: plans.describeCount(active, plans.limit(organization, 'apiKeys')),
      callUsage: plans.describeCount(monthly, plans.limit(organization, 'apiCallsPerMonth')),
      recentDays: recent,
    })
  }

  async store({ request, response, session, auth, organization, bouncer }: HttpContext) {
    await bouncer.with('ApiKeyPolicy').authorize('create', organization)

    const payload = await request.validateUsing(createApiKeyValidator)

    try {
      const { apiKey, secret } = await apiKeys.create(organization, auth.use('web').user!, {
        name: payload.name,
        scopes: payload.scopes,
        environment: payload.environment,
      })

      /**
       * Flashed rather than rendered inline, because the redirect is what
       * stops a refresh from re-submitting the form — and this is the only
       * moment the secret exists, so losing it to a double-submit would mean
       * minting another key.
       */
      session.flash('createdApiKey', { secret, name: apiKey.name })
      session.flash('success', `"${apiKey.name}" is ready. Copy it now — it is not shown again.`)
    } catch (error) {
      if (error instanceof ApiKeyError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('api_keys.index')
      }

      throw error
    }

    return response.redirect().toRoute('api_keys.index')
  }

  async destroy({ params, response, session, organization, bouncer }: HttpContext) {
    const apiKey = await apiKeys.find(organization, params.id)

    if (!apiKey) {
      session.flash('error', 'That key no longer exists.')
      return response.redirect().toRoute('api_keys.index')
    }

    await bouncer.with('ApiKeyPolicy').authorize('revoke', apiKey)
    await apiKeys.revoke(apiKey)

    session.flash(
      'success',
      `"${apiKey.name}" is revoked. Any integration using it stops working immediately.`
    )

    return response.redirect().toRoute('api_keys.index')
  }
}
