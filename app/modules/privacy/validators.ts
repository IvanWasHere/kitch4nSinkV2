import vine from '@vinejs/vine'

/**
 * Asking to be deleted. The password is checked by `DeletionService`, which
 * knows whether the account has one; the checkbox is what makes the request
 * deliberate rather than a misplaced click.
 */
export const requestDeletionValidator = vine.create({
  password: vine.string().maxLength(200).nullable().optional(),
  understood: vine.accepted(),
})

/**
 * An admin's reason for saying no — sent to the person, so it is required.
 */
export const rejectDeletionValidator = vine.create({
  reason: vine.string().trim().minLength(5).maxLength(500),
})

/**
 * Staff deleting an account on somebody's behalf. The typed address is
 * compared to the account's in the controller — it is the "are you sure"
 * that a click cannot give by accident.
 */
export const staffDeletionValidator = vine.create({
  user: vine.string().trim(),
  reason: vine.string().trim().minLength(5).maxLength(500),
  confirmEmail: vine.string().trim().toLowerCase(),
})

export const staffExportValidator = vine.create({
  user: vine.string().trim(),
})
