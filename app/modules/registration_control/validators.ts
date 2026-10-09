import vine from '@vinejs/vine'

/**
 * The registration settings form. Both are checkboxes, and an unticked
 * checkbox is not submitted at all — so absent means `false`, which is why
 * these are optional rather than required.
 */
export const registrationSettingsValidator = vine.create({
  registrationEnabled: vine.boolean().optional(),
  waitingListDoubleOptIn: vine.boolean().optional(),
})

/**
 * Joining the waiting list. Only the shape is checked here — whether the
 * address already has an account is deliberately *not* a validation error,
 * because the answer must not reach the person asking (plan §22.5).
 */
export const joinWaitingListValidator = vine.create({
  email: vine.string().trim().email().maxLength(254).toLowerCase(),
})
