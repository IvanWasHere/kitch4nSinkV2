import type { HttpContext } from '@adonisjs/core/http'

import audit from '#audit/audit_service'
import settings from '#settings/settings_service'
import privacy, { PrivacyError } from '#modules/privacy/services/privacy_service'
import deletion from '#modules/privacy/services/deletion_service'
import { requestDeletionValidator } from '#modules/privacy/validators'
import '#modules/privacy/audit_actions'

/**
 * Settings → Privacy (plan §22.8). Every member, for their own data only.
 *
 * Somebody impersonating the user can look but not act: an export is a copy
 * of the person's whole account, and staff reading customer data has its own
 * audited paths in the back office. The impersonation middleware already
 * blocks writes for support; this also refuses an *admin* impersonation,
 * which that middleware would let through.
 */
export default class PrivacyController {
  async index({ view, auth, impersonation }: HttpContext) {
    const user = auth.use('web').user!

    const [requests, ttlHours, activeDeletion, alsoDeleted] = await Promise.all([
      privacy.requestsFor(user),
      settings.get('privacy_export_ttl_hours'),
      deletion.active(user),
      deletion.alsoDeleted(user),
    ])

    return view.render('pages/privacy/index', {
      requests,
      ttlHours,
      activeDeletion,
      alsoDeleted,
      ownsWorkspace: user.role === 'owner',
      hasPassword: user.hasPassword,
      impersonating: Boolean(impersonation),
    })
  }

  async requestExport(ctx: HttpContext) {
    const { auth, response, session, impersonation } = ctx

    if (impersonation) {
      session.flash('error', 'A data export can only be requested by the person it belongs to.')
      return response.redirect().toRoute('settings.privacy')
    }

    const user = auth.use('web').user!
    const { request, created } = await privacy.requestExport(user)

    if (created) {
      await audit.recordUserAction(ctx, {
        action: 'privacy.export.requested',
        subjectType: 'PrivacyRequest',
        subjectId: request.publicId,
      })
    }

    session.flash(
      'success',
      created
        ? 'We are preparing your export. We will email you when it is ready — usually within a few minutes.'
        : 'Your export is already being prepared. We will email you when it is ready.'
    )
    return response.redirect().toRoute('settings.privacy')
  }

  /**
   * Re-checks everything on every download — whose it is, that it finished,
   * that it has not expired — and only then mints a link that lasts minutes.
   * The link is never put in an email or a page.
   */
  async download(ctx: HttpContext) {
    const { auth, params, response, session, impersonation } = ctx

    if (impersonation) {
      session.flash('error', 'A data export can only be downloaded by the person it belongs to.')
      return response.redirect().toRoute('settings.privacy')
    }

    const user = auth.use('web').user!
    const request = await privacy.findOwned(user, params.id)

    /**
     * Somebody else's export is a 404, exactly like one that never existed —
     * not a 403 that confirms it is there.
     */
    if (!request || !request.isExport) {
      return response.notFound()
    }

    if (!request.isDownloadable) {
      session.flash('error', 'That export has expired. Ask for a new one below.')
      return response.redirect().toRoute('settings.privacy')
    }

    const url = await privacy.downloadUrl(request)

    await audit.recordUserAction(ctx, {
      action: 'privacy.export.downloaded',
      subjectType: 'PrivacyRequest',
      subjectId: request.publicId,
    })

    /**
     * `clearQs()`: a forwarded query string appended after a signature is not
     * what was signed.
     */
    return response.redirect().clearQs().toPath(url)
  }

  /**
   * Ask for the account to be deleted (plan §22.8.2). Confirmed here by the
   * password, or — for an account without one — by an emailed link. Either
   * way it then waits for an admin.
   */
  async requestDeletion(ctx: HttpContext) {
    const { auth, request, response, session, impersonation } = ctx

    if (impersonation) {
      session.flash('error', 'Only the person an account belongs to can ask for it to be deleted.')
      return response.redirect().toRoute('settings.privacy')
    }

    const payload = await request.validateUsing(requestDeletionValidator)
    const user = auth.use('web').user!

    try {
      const result = await deletion.request(user, { password: payload.password })

      if (result.created) {
        await audit.recordUserAction(ctx, {
          action:
            result.request.status === 'confirmed'
              ? 'privacy.deletion.confirmed'
              : 'privacy.deletion.requested',
          subjectType: 'PrivacyRequest',
          subjectId: result.request.publicId,
        })
      }

      session.flash(
        'success',
        result.emailed
          ? 'Check your email and follow the link to confirm. Nothing happens until you do.'
          : 'Your request is with our team. We will email you when it has been handled.'
      )
    } catch (error) {
      if (error instanceof PrivacyError) {
        session.flash('error', error.message)
      } else {
        throw error
      }
    }

    return response.redirect().toRoute('settings.privacy')
  }

  async cancelDeletion(ctx: HttpContext) {
    const { auth, response, session, impersonation } = ctx

    if (impersonation) {
      session.flash('error', 'Only the person an account belongs to can change this request.')
      return response.redirect().toRoute('settings.privacy')
    }

    const request = await deletion.active(auth.use('web').user!)

    if (!request) {
      return response.redirect().toRoute('settings.privacy')
    }

    try {
      await deletion.cancel(request)
    } catch (error) {
      if (error instanceof PrivacyError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('settings.privacy')
      }

      throw error
    }

    await audit.recordUserAction(ctx, {
      action: 'privacy.deletion.cancelled',
      subjectType: 'PrivacyRequest',
      subjectId: request.publicId,
    })

    session.flash('success', 'Your deletion request has been cancelled. Your account is unchanged.')
    return response.redirect().toRoute('settings.privacy')
  }

  /**
   * The emailed confirmation link. Works signed out — people open mail on a
   * phone — and says nothing about the account beyond the outcome.
   */
  async confirmDeletion({ params, view }: HttpContext) {
    const { outcome, request } = await deletion.confirm(params.token)

    if (outcome === 'confirmed' && request) {
      await audit.recordSystemAction({
        action: 'privacy.deletion.confirmed',
        subjectType: 'PrivacyRequest',
        subjectId: request.publicId,
        metadata: { via: 'email' },
      })
    }

    return view.render('pages/privacy/deletion_confirmation', { outcome })
  }
}
