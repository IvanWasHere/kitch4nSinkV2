import { plans } from '#config/plans'
import type Notification from '#models/notification'

/**
 * What an authoring form may say about an audience, before it is trusted.
 */
export interface AudienceInput {
  planKeys?: unknown
  userIds?: unknown
}

/**
 * Reduce a submitted audience to the shape the predicate expects, keeping
 * only what the chosen type actually uses (plan §20.3).
 *
 * Two jobs, and the second is the important one:
 *
 * 1. Drop anything unrecognised — a plan key that no longer exists, an id
 *    that is not a number.
 * 2. **Drop the fields the type does not use.** An author who picks `users`
 *    after filling in plans must not leave a `planKeys` list behind in the
 *    row: it would be invisible in the UI, ignored by the predicate today,
 *    and quietly wrong the day somebody widens the rule.
 */
export function normalizeAudience(
  audienceType: Notification['audienceType'],
  input: AudienceInput | null | undefined
): Notification['audience'] {
  const planKeys = toPlanKeys(input?.planKeys)
  const userIds = toUserIds(input?.userIds)

  switch (audienceType) {
    case 'all':
      return null

    case 'plan':
      return { planKeys }

    case 'owners':
      /**
       * Optional here: no plans means "owners on any plan".
       */
      return planKeys.length ? { planKeys } : null

    case 'users':
      return { userIds }

    default:
      return null
  }
}

function toPlanKeys(value: unknown): string[] {
  const submitted = Array.isArray(value) ? value : value === undefined ? [] : [value]

  return Object.keys(plans).filter((key) => submitted.includes(key))
}

/**
 * Ids are stored as numbers, and compared as numbers by the predicate — so a
 * form value of `"7"` becomes `7` here rather than sitting in the row as a
 * string that would silently never match.
 */
function toUserIds(value: unknown): number[] {
  const submitted = Array.isArray(value) ? value : value === undefined ? [] : [value]

  const ids = submitted
    .map((entry) => Number(entry))
    .filter((entry) => Number.isSafeInteger(entry) && entry > 0)

  return [...new Set(ids)]
}
