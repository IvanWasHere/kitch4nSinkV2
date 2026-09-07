import vine from '@vinejs/vine'

/**
 * Back-office request bodies (plan §12).
 */
export const createStaffValidator = vine.create({
  email: vine.string().trim().email().maxLength(254),
  fullName: vine.string().trim().minLength(1).maxLength(120),

  /**
   * The same minimum the tenant side uses. Staff hold more power, not less,
   * so a weaker rule here would be indefensible — and two-factor is
   * mandatory on top of it.
   */
  password: vine.string().minLength(12).maxLength(200),
  role: vine.enum(['admin', 'support'] as const),
})

/**
 * Authoring an announcement (plan §20).
 *
 * `audienceType` is validated as a closed set here; *which* plans or users it
 * carries is normalised by `#notifications/input`, because that has to drop
 * the fields the chosen type does not use — a rule about the relationship
 * between two fields rather than about either one.
 */
export const createNotificationValidator = vine.create({
  title: vine.string().trim().minLength(1).maxLength(120),
  body: vine.string().trim().minLength(1).maxLength(2000),
  level: vine.enum(['info', 'success', 'warning', 'error'] as const).optional(),
  audienceType: vine.enum(['all', 'plan', 'owners', 'users'] as const),

  /**
   * Both halves of the call to action, or neither. A label with no URL is a
   * button that does nothing, which is worse than no button.
   */
  actionLabel: vine.string().trim().maxLength(60).nullable().optional(),
  actionUrl: vine.string().trim().url().maxLength(1024).nullable().optional(),

  saveAsDraft: vine.accepted().optional(),
  expiresAt: vine.string().trim().nullable().optional(),
})
