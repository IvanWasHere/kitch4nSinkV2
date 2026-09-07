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
