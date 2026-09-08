import type { Session } from '@adonisjs/session'

/**
 * Input a form may send but the flash store must never keep.
 *
 * `flashAll()` puts the whole request body back into the session so a
 * rejected form can be re-rendered with what the person typed. That is right
 * for a name and wrong for a password: the session is written to an encrypted
 * cookie, or to a `sessions` row, and lives well past the redirect it was
 * needed for. None of these fields is ever re-rendered anyway — the input
 * component refuses to fill a `password` control from old input — so
 * withholding them costs nothing.
 *
 * `code` covers the six-digit authenticator code and the recovery code that
 * can be used in its place; `token` covers the reset and invitation links,
 * which are credentials while they are alive.
 */
const SECRET_INPUT_KEYS = [
  'password',
  'passwordConfirmation',
  'currentPassword',
  'newPassword',
  'code',
  'token',
]

/**
 * Flash the form back, minus the parts of it that are secrets.
 *
 * Use in place of `session.flashAll()` anywhere a form that can carry a
 * credential is being sent back to the person who submitted it.
 */
export function flashInputSafely(session: Session): void {
  session.flashExcept(SECRET_INPUT_KEYS)
}
