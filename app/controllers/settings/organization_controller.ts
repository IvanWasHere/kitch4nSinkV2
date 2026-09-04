import type { HttpContext } from '@adonisjs/core/http'

import memberships from '#organizations/membership_service'
import { seatUsage } from '#organizations/seats'
import { planFor } from '#config/plans'
import {
  deleteOrganizationValidator,
  organizationSettingsValidator,
} from '#validators/organization'

/**
 * Workspace settings — the mockup's "Store Settings" card, on its own route
 * so the owner-only permission maps onto a URL rather than onto a section of
 * a page (plan §13.6.4).
 */
export default class OrganizationSettingsController {
  async edit({ view, auth, organization, bouncer }: HttpContext) {
    const user = auth.use('web').user!
    await bouncer.with('OrganizationPolicy').authorize('view', organization)

    const canManage = await bouncer.with('OrganizationPolicy').allows('update', organization)
    const allMembers = await memberships.members(organization)

    return view.render('pages/settings/organization', {
      canManage,
      isOwner: user.id === organization.ownerId,
      plan: planFor(organization.planKey),
      usage: await seatUsage(organization),
      members: allMembers.filter((member) => member.id !== organization.ownerId),
    })
  }

  async update({ request, response, session, organization, bouncer }: HttpContext) {
    await bouncer.with('OrganizationPolicy').authorize('update', organization)

    const { name } = await request.validateUsing(organizationSettingsValidator)

    organization.name = name
    await organization.save()

    session.flash('success', 'Workspace settings saved.')
    return response.redirect().toRoute('settings.organization')
  }

  /**
   * Deleting soft-deletes the workspace and everyone in it — nothing is
   * erased (D9). Whether deleted workspaces are eventually purged is plan
   * §19 Q2, still open.
   */
  async destroy({ request, response, session, auth, organization, bouncer }: HttpContext) {
    await bouncer.with('OrganizationPolicy').authorize('delete', organization)

    const { confirmation } = await request.validateUsing(deleteOrganizationValidator)

    if (confirmation.trim() !== organization.name) {
      session.flash('error', 'Type the workspace name exactly to confirm deletion.')
      return response.redirect().toRoute('settings.organization')
    }

    await memberships.deleteOrganization(organization)
    await auth.use('web').logout()

    session.flash('success', `${organization.name} has been deleted.`)
    return response.redirect().toRoute('home')
  }
}
