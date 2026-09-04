import vine from '@vinejs/vine'

/**
 * Validation for the authentication flows.
 *
 * Rules here are about shape and uniqueness only. Whether a *given* password
 * is correct, or a token still valid, is decided by the model and the token
 * service — a validator that talked to the session would be a second place
 * for authorisation to live.
 */

const email = () => vine.string().trim().email().maxLength(254).toLowerCase()

/**
 * Twelve characters is the floor rather than eight: this is a workspace that
 * holds a whole team's data, and the strength meter on the signup screen
 * nudges towards more. There is no upper bound worth enforcing beyond what
 * the hash accepts.
 */
const password = () => vine.string().minLength(12).maxLength(180)

export const registerValidator = vine.create({
  fullName: vine.string().trim().minLength(1).maxLength(120).nullable(),
  organizationName: vine.string().trim().minLength(1).maxLength(120).optional(),
  email: email().unique({ table: 'users', column: 'email' }),
  password: password().confirmed({ confirmationField: 'passwordConfirmation' }),
})

export const loginValidator = vine.create({
  email: email(),
  password: vine.string(),
  rememberMe: vine.accepted().optional(),
})

export const forgotPasswordValidator = vine.create({
  email: email(),
})

export const resetPasswordValidator = vine.create({
  password: password().confirmed({ confirmationField: 'passwordConfirmation' }),
})

export const changePasswordValidator = vine.create({
  currentPassword: vine.string(),
  password: password().confirmed({ confirmationField: 'passwordConfirmation' }),
})

/**
 * A six-digit authenticator code, or a recovery code in the `abcde-fghij`
 * shape. The challenge screen accepts either in one field, because being told
 * "wrong box" while locked out of your own account is miserable.
 */
export const twoFactorChallengeValidator = vine.create({
  code: vine.string().trim().minLength(6).maxLength(24),
})

export const twoFactorConfirmValidator = vine.create({
  code: vine
    .string()
    .trim()
    .regex(/^\d{6}$/),
})

export const profileValidator = vine.create({
  fullName: vine.string().trim().minLength(1).maxLength(120).nullable(),
})
