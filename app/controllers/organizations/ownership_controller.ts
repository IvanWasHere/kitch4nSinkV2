import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import memberships, { MembershipError } from '#organizations/membership_service'
import { parsePublicId } from '#models/public_id'
import { transferOwnershipValidator } from '#validators/organization'

/**
 * Ownership transfer.
 *
 * There is exactly one owner, so this is also the only way anyone's role
 * changes: promoting someone to owner necessarily demotes the current one.
 */
export default class OwnershipController {
  async transfer({ request, response, session, auth, organization, bouncer }: HttpContext) {
    const user = auth.use('web').user!
    await bouncer.with('OrganizationPolicy').authorize('transferOwnership', organization)

    const { memberPublicId, confirmation } = await request.validateUsing(transferOwnershipValidator)

    /**
     * Handing the workspace to someone else cannot be undone by the person
     * doing it, so it asks for the workspace name in the same way deletion
     * does.
     */
    if (confirmation.trim() !== organization.name) {
      session.flash('error', 'Type the workspace name exactly to confirm the transfer.')
      return response.redirect().toRoute('settings.organization')
    }

    const parsed = parsePublicId('user', memberPublicId)
    const target = parsed
      ? await User.query()
          .where('public_id', parsed)
          .where('organization_id', organization.id)
          .whereNull('deleted_at')
          .first()
      : null

    if (!target) {
      session.flash('error', 'Choose a member of this workspace to transfer ownership to.')
      return response.redirect().toRoute('settings.organization')
    }

    try {
      await memberships.transferOwnership(organization, user, target)
    } catch (error) {
      if (error instanceof MembershipError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('settings.organization')
      }
      throw error
    }

    session.flash(
      'success',
      `${target.displayName} now owns ${organization.name}. You are a member.`
    )
    return response.redirect().toRoute('settings.organization')
  }
}
