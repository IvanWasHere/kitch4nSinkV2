import type { Session } from '@adonisjs/session'

/**
 * The half-authenticated state between "password accepted" and "second factor
 * proved".
 *
 * It lives in the session rather than in the auth guard on purpose: until the
 * code is verified there is no authenticated user, so nothing downstream can
 * mistake a pending challenge for a login. The pending id also expires on its
 * own, so an abandoned challenge on a shared computer does not sit there
 * waiting to be completed by whoever sits down next.
 */
const SESSION_KEY = 'two_factor_challenge'
const TTL_MS = 10 * 60 * 1000

export type ChallengeGuard = 'web' | 'staff'

interface PendingChallenge {
  guard: ChallengeGuard
  userId: number
  startedAt: number
}

export function startTwoFactorChallenge(session: Session, guard: ChallengeGuard, userId: number) {
  session.put(SESSION_KEY, { guard, userId, startedAt: Date.now() } satisfies PendingChallenge)
}

export function pendingTwoFactorChallenge(
  session: Session,
  guard: ChallengeGuard
): PendingChallenge | null {
  const pending = session.get(SESSION_KEY) as PendingChallenge | undefined

  if (!pending || pending.guard !== guard) {
    return null
  }

  if (Date.now() - pending.startedAt > TTL_MS) {
    session.forget(SESSION_KEY)
    return null
  }

  return pending
}

export function clearTwoFactorChallenge(session: Session) {
  session.forget(SESSION_KEY)
}
