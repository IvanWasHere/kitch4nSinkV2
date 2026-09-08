/*
|--------------------------------------------------------------------------
| Rate limits on the authentication surface
|--------------------------------------------------------------------------
|
| Every unauthenticated POST in this application is a place where somebody
| else's password, one-time code or invitation token can be guessed, or where
| our mail reputation can be spent on somebody who never asked for the email.
| The organisation API has had limits since M6 (§11); these are the same idea
| pointed at the front door (M8).
|
| Four rules, deliberately layered rather than merged into one:
|
| - **By address** — the blunt one. Stops a single host hammering the whole
|   auth surface, whatever endpoint it picks.
| - **By address *and* account** — the sharp one. A password guesser works
|   through candidates for one address, so counting that pair is what actually
|   costs them, and it does so without letting anybody lock a stranger out of
|   their account by burning the limit from a different network.
| - **By account** — only where the cost is an *email* rather than a session
|   (password reset, verification resend). The thing being protected there is
|   somebody's inbox, so the address is the right key even though it means a
|   determined attacker can stop *themselves* being able to request one.
| - **By pending challenge** — a six-digit code is 10^6 wide, which is only
|   safe while guesses are slow.
|
| Two properties of the limiter that are easy to be surprised by, so they are
| stated here rather than discovered later:
|
| 1. It counts **requests, not failures**. A successful login spends a point
|    exactly like a wrong password does. Every window below is therefore sized
|    for a person having a bad morning behind an office NAT, not for the
|    theoretical minimum. If you want to count only failures, that means
|    consuming from the controller instead — see CONTRIBUTING.md.
| 2. Keys are hashed where they would otherwise be an email address. The
|    `rate_limits` table is operational data with no retention policy of its
|    own; there is no reason for it to accumulate a list of who tried to sign
|    in and when.
|
*/

import { createHash } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import limiter from '@adonisjs/limiter/services/main'

import { twoFactorChallengeSubject } from '#auth/two_factor_challenge'

/**
 * An email address, reduced to something safe to store.
 *
 * Normalised first, or `Ada@example.com` and `ada@example.com` would be two
 * separate budgets for one account.
 */
function accountKey(email: unknown): string {
  const normalised = typeof email === 'string' ? email.trim().toLowerCase() : ''

  return createHash('sha256').update(normalised).digest('hex').slice(0, 32)
}

/**
 * The address the request came from.
 *
 * `request.ip()` already honours `trustProxy` from `config/app.ts`, which is
 * the setting that decides whether this is the client or your load balancer.
 * Get that wrong behind a proxy and every one of these limits becomes a
 * single shared bucket for the whole internet — it is worth checking once,
 * per environment.
 */
function addressKey(ctx: HttpContext): string {
  return ctx.request.ip()
}

/**
 * The whole signed-out surface, by address.
 *
 * Applied to the guest group as a group, GETs included: reset and invitation
 * links are guessable-shaped URLs, and a limit that only counted POSTs would
 * leave the guessing of them unmetered.
 *
 * Sized for a person, not a minimum: loading three pages, submitting a form,
 * getting it wrong and trying again is well inside it.
 */
export const authAddressThrottle = limiter.define('auth_address', (ctx) => {
  return limiter.allowRequests(60).every('5 minutes').usingKey(addressKey(ctx))
})

/**
 * Sign-in attempts, by address **and** account.
 *
 * The pair is the point. Keyed on the account alone, anybody could lock a
 * known address out of their own login by spending the budget from somewhere
 * else; keyed on the address alone, a guesser gets the same allowance for
 * every account they try in turn.
 */
export const loginThrottle = limiter.define('login', (ctx) => {
  const email = ctx.request.input('email')

  return limiter
    .allowRequests(10)
    .every('15 minutes')
    .usingKey(`${addressKey(ctx)}:${accountKey(email)}`)
    .limitExceeded((error) => {
      error.setMessage('Too many sign-in attempts. Try again in a few minutes.')
    })
})

/**
 * Registration, by address.
 *
 * Signing up is cheap for us and cheap for a script: each one sends mail and
 * creates an organisation. Five an hour from one address is generous for a
 * person and useless for a farm.
 */
export const signupThrottle = limiter.define('signup', (ctx) => {
  return limiter
    .allowRequests(5)
    .every('1 hour')
    .usingKey(addressKey(ctx))
    .limitExceeded((error) => {
      error.setMessage('Too many accounts created from here. Try again later.')
    })
})

/**
 * Password reset requests, by **account**.
 *
 * The resource being protected is the mailbox on the other end, and the
 * attacker is somebody using our sender to bother a person who did nothing
 * wrong. That makes the address the right key here even though it is the
 * wrong one for login: the worst case is a legitimate user waiting an hour
 * for a fourth reset email, and they still have the first three.
 */
export const passwordResetThrottle = limiter.define('password_reset', (ctx) => {
  return limiter
    .allowRequests(3)
    .every('1 hour')
    .usingKey(accountKey(ctx.request.input('email')))
    .limitExceeded((error) => {
      error.setMessage('A reset link has already been sent. Check your inbox, or try again later.')
    })
})

/**
 * Verification emails, by the user asking for one.
 *
 * Same reasoning as the reset limit, one step further in: this route is
 * behind the auth guard, so the account is known without reading the body.
 */
export const verificationResendThrottle = limiter.define('verification_resend', (ctx) => {
  const userId = ctx.auth?.user?.id

  return limiter
    .allowRequests(3)
    .every('1 hour')
    .usingKey(userId ? `user:${userId}` : addressKey(ctx))
    .limitExceeded((error) => {
      error.setMessage('Another verification email is on its way. Check your inbox first.')
    })
})

/**
 * Second-factor attempts, by the pending challenge.
 *
 * Six digits is a million possibilities, which sounds like plenty until it is
 * divided by a script's request rate: unthrottled, the current window of a
 * TOTP code is guessable in minutes. Ten tries per challenge is more than a
 * person mistyping needs and stops that arithmetic dead.
 *
 * Keyed by the half-authenticated subject rather than the address, so a
 * shared network cannot be used to burn somebody else's attempts — and, when
 * there is no pending challenge at all, by address, because then the request
 * has no business here anyway.
 */
export const twoFactorThrottle = limiter.define('two_factor', (ctx) => {
  const subject = twoFactorChallengeSubject(ctx.session)

  return limiter
    .allowRequests(10)
    .every('15 minutes')
    .usingKey(subject ? `challenge:${subject}` : addressKey(ctx))
    .limitExceeded((error) => {
      error.setMessage('Too many codes tried. Start signing in again.')
    })
})

/**
 * The back-office login, by address.
 *
 * Tighter than the customer-facing one by an order of magnitude, for the
 * reason the back-office has its own table and its own guard (D5): the set of
 * people who legitimately sign in here is small, known, and never in a hurry.
 * Two-factor is mandatory on this surface, so this is the outer of two locks.
 */
export const adminLoginThrottle = limiter.define('admin_login', (ctx) => {
  return limiter
    .allowRequests(5)
    .every('15 minutes')
    .usingKey(`${addressKey(ctx)}:${accountKey(ctx.request.input('email'))}`)
    .limitExceeded((error) => {
      error.setMessage('Too many sign-in attempts.')
    })
})
