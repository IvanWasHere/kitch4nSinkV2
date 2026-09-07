import type { HttpContext } from '@adonisjs/core/http'

import files from '#storage/file_service'
import memberships from '#organizations/membership_service'
import { seatUsage } from '#organizations/seats'
import { planFor } from '#config/plans'
import { UploadRejectedError } from '#storage/contracts'
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

  /**
   * A workspace logo, on the **public** disk for the same reason an avatar is
   * (plan §10): the shell renders it on every page, so it must have a plain
   * cacheable URL rather than one that expires.
   *
   * Owner-only, through the same policy that guards renaming the workspace.
   */
  async updateLogo({ request, response, session, auth, organization, bouncer }: HttpContext) {
    await bouncer.with('OrganizationPolicy').authorize('update', organization)

    const upload = request.file('logo')

    if (!upload || !upload.tmpPath) {
      session.flash('error', 'Choose an image to upload.')
      return response.redirect().toRoute('settings.organization')
    }

    try {
      const file = await files.replaceAttachment(organization, auth.use('web').user!, {
        tmpPath: upload.tmpPath,
        clientName: upload.clientName,
        sizeBytes: upload.size,
        attachTo: { type: 'Organization', id: organization.id },
      })

      if (!file.isImage) {
        throw new UploadRejectedError('A logo has to be an image.', 'extension_not_allowed')
      }

      organization.logoKey = file.key
      await organization.save()

      session.flash('success', 'Your logo has been updated.')
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('settings.organization')
      }

      throw error
    }

    return response.redirect().toRoute('settings.organization')
  }

  async update({ request, response, session, organization, bouncer }: HttpContext) {
    await bouncer.with('OrganizationPolicy').authorize('update', organization)

    const { name, timezone } = await request.validateUsing(organizationSettingsValidator)

    organization.name = name

    /**
     * Due dates are stored UTC and rendered here (plan §5.6), so this is what
     * decides whether a todo due "today" is late.
     */
    if (timezone) {
      organization.timezone = timezone
    }

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
