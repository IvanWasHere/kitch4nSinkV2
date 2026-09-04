import vine from '@vinejs/vine'

/**
 * Validation for organisation and team management.
 */

export const organizationSettingsValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(120),
  /**
   * An IANA zone name. Due dates are stored UTC and rendered in this
   * (plan §5.6), so it decides whether something due "today" is late.
   */
  timezone: vine.string().trim().maxLength(64).in(Intl.supportedValuesOf('timeZone')).optional(),
})

/**
 * Deleting a workspace asks for its name to be typed back. The comparison
 * against the actual name happens in the controller, which knows it —
 * a validator that reached for the session would be authorisation in the
 * wrong place.
 */
export const deleteOrganizationValidator = vine.create({
  confirmation: vine.string().trim(),
})

export const inviteMemberValidator = vine.create({
  email: vine.string().trim().email().maxLength(254).toLowerCase(),
})

export const transferOwnershipValidator = vine.create({
  memberPublicId: vine.string().trim(),
  confirmation: vine.string().trim(),
})

/**
 * Accepting an invitation. An address that has no account yet sets a password
 * here; one that does is attached to the workspace without one.
 */
export const acceptInvitationValidator = vine.create({
  fullName: vine.string().trim().minLength(1).maxLength(120).nullable(),
  password: vine
    .string()
    .minLength(12)
    .maxLength(180)
    .confirmed({ confirmationField: 'passwordConfirmation' }),
})
