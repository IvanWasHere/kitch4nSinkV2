import type { HttpContext } from '@adonisjs/core/http'

import File from '#models/file'
import ApiKey from '#models/api_key'
import Organization from '#models/organization'
import plans from '#billing/plan_service'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import billing from '#billing/billing_service'
import search from '#admin/search_service'
import memberships from '#organizations/membership_service'
import { plans as planCatalogue, type PlanKey } from '#config/plans'

/**
 * Organisations in the back-office (plan §12).
 *
 * The screen support opens when a ticket arrives: who is in this workspace,
 * what are they paying, what have they uploaded, and what has been done to
 * them.
 */
export default class AdminOrganizationController {
  async index({ view, request, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const term = String(request.input('q', ''))

    return view.render('pages/admin/organizations/index', {
      term,
      organizations: await search.organizations(term),
    })
  }

  async show({ params, view, response, session, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const organization = await Organization.query().where('public_id', params.id).first()

    if (!organization) {
      session.flash('error', 'No such organisation.')
      return response.redirect().toRoute('admin.organizations.index')
    }

    const [members, subscription, payments, usage, files, keys, trail, canManage, canOverride] =
      await Promise.all([
        memberships.members(organization),
        billing.activeSubscription(organization),
        billing.payments(organization, 12),
        plans.usage(organization),
        File.query()
          .where('organization_id', organization.id)
          .whereNull('deleted_at')
          .orderBy('id', 'desc')
          .limit(10),
        ApiKey.query()
          .where('organization_id', organization.id)
          .whereNull('revoked_at')
          .orderBy('id', 'desc'),
        audit.forOrganization(organization, 20),
        staffBouncer.with('StaffPolicy').allows('suspendOrganization'),
        staffBouncer.with('StaffPolicy').allows('overridePlan'),
      ])

    return view.render('pages/admin/organizations/show', {
      organization,
      members,
      subscription,
      payments,
      usage,
      files,
      keys,
      trail,
      canManage,
      canOverride,
      planKeys: Object.keys(planCatalogue),
    })
  }

  /**
   * Suspend a workspace, or let it back in.
   *
   * Admin only (plan §6): `suspended` is the one status that denies access,
   * so this takes a paying customer's team out of their work. Every use is
   * audited with the reason, because the next question is always "who did
   * this and why".
   */
  async suspend(ctx: HttpContext) {
    const { params, request, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('suspendOrganization')

    const organization = await Organization.query().where('public_id', params.id).firstOrFail()
    const suspending = organization.status !== 'suspended'
    const reason = String(request.input('reason', '')).slice(0, 500)

    if (suspending && !reason) {
      session.flash('error', 'Say why. A suspension with no reason is unanswerable later.')
      return response.redirect().back()
    }

    /**
     * Restoring returns the workspace to `active` rather than to whatever it
     * was before. If billing is genuinely still failing, the next webhook or
     * `billing:sync` puts it back to `past_due` — guessing here would restore
     * a state that may no longer be true.
     */
    organization.status = suspending ? 'suspended' : 'active'
    await organization.save()

    await audit.recordStaffAction(ctx, {
      action: suspending ? AUDIT_ACTIONS.organizationSuspended : AUDIT_ACTIONS.organizationRestored,
      organization,
      subjectType: 'Organization',
      subjectId: organization.publicId,
      metadata: { reason: reason || null },
    })

    session.flash(
      'success',
      suspending
        ? `${organization.name} is suspended. Everyone in it is signed out.`
        : `${organization.name} is active again.`
    )

    return response.redirect().back()
  }

  /**
   * Override the plan without a payment behind it (plan §7.4).
   *
   * Admin only, because it is a discount nobody invoiced. It writes
   * `plan_key` and nothing else — the subscription mirror keeps saying what
   * the provider actually thinks, so `billing:sync` will report the
   * difference rather than the two silently agreeing on a lie.
   */
  async overridePlan(ctx: HttpContext) {
    const { params, request, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('overridePlan')

    const organization = await Organization.query().where('public_id', params.id).firstOrFail()
    const planKey = String(request.input('plan_key', ''))

    if (!(planKey in planCatalogue)) {
      session.flash('error', 'That plan does not exist.')
      return response.redirect().back()
    }

    const previous = organization.planKey
    await plans.applyPlan(organization, planKey as PlanKey)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.planOverridden,
      organization,
      subjectType: 'Organization',
      subjectId: organization.publicId,
      metadata: {
        from: previous,
        to: planKey,
        reason: String(request.input('reason', '')) || null,
      },
    })

    session.flash('success', `${organization.name} moved from ${previous} to ${planKey}.`)
    return response.redirect().back()
  }

  /**
   * Raise a single limit without changing the plan (plan §7.4) — the
   * standard "just let this customer have five more lists while we sort out
   * billing" request.
   */
  async overrideLimits(ctx: HttpContext) {
    const { params, request, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('overridePlan')

    const organization = await Organization.query().where('public_id', params.id).firstOrFail()

    const limit = String(request.input('limit', ''))

    /**
     * Read before stringifying, because `config/bodyparser.ts` sets
     * `convertEmptyStringsToNull` — so an empty field arrives as `null`, and
     * `String(null)` is the string `"null"`, which is neither empty nor a
     * number. Left unhandled, "clear this override" silently did nothing.
     */
    const submitted = request.input('value')
    const rawValue = submitted === null || submitted === undefined ? '' : String(submitted).trim()

    if (!(limit in planCatalogue.free.limits)) {
      session.flash('error', 'That is not a limit.')
      return response.redirect().back()
    }

    const overrides = { ...(organization.limitOverrides ?? {}) }

    if (rawValue === '') {
      /**
       * Empty clears the override and returns the organisation to its plan's
       * own limit — distinct from `unlimited`, which is a grant.
       */
      delete overrides[limit]
    } else if (rawValue === 'unlimited') {
      overrides[limit] = null
    } else {
      const value = Number(rawValue)

      if (!Number.isInteger(value) || value < 0) {
        session.flash('error', 'A limit is a whole number, empty to clear, or "unlimited".')
        return response.redirect().back()
      }

      overrides[limit] = value
    }

    organization.limitOverrides = Object.keys(overrides).length > 0 ? overrides : null
    await organization.save()

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.limitsOverridden,
      organization,
      subjectType: 'Organization',
      subjectId: organization.publicId,
      metadata: { limit, value: rawValue === '' ? 'cleared' : rawValue },
    })

    session.flash('success', `${limit} override updated for ${organization.name}.`)
    return response.redirect().back()
  }
}
