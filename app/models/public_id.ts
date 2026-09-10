import { customAlphabet } from 'nanoid'

/**
 * Public ids (D6)
 * ---------------
 * Every tenant-visible row is addressed by a prefixed, random `public_id`
 * rather than by its integer primary key. Sequential integers in URLs and in
 * the API leak customer counts and make invitation enumeration trivial, and
 * native UUID column types differ between SQLite and Postgres — a plain string
 * behaves identically on both.
 *
 * The prefix is not decoration: it lets `parsePublicId` reject an id belonging
 * to a different resource, so a list id can never be smuggled into a route
 * expecting a user id.
 */

/**
 * Lowercase alphanumerics minus the characters that are easy to misread when
 * a support agent copies an id out of a ticket: l, 1, i, o, 0.
 */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

/**
 * 12 characters over a 31-symbol alphabet is ~59 bits of entropy — collision
 * resistant far beyond the scale of a single tenant's data, while staying
 * short enough to read aloud.
 */
const ID_LENGTH = 12

const randomId = customAlphabet(ALPHABET, ID_LENGTH)

/**
 * The prefix registry. Adding a table that carries a `public_id` means adding
 * its prefix here, which is also what makes an exhaustive test possible.
 */
export const PUBLIC_ID_PREFIXES = {
  organization: 'org',
  user: 'usr',
  staffUser: 'stf',
  invitation: 'inv',
  payment: 'pay',
  apiKey: 'key',
  notification: 'ntf',
  file: 'fil',
  todoList: 'lst',
  todo: 'tdo',
  supportTicket: 'tkt',
  supportMessage: 'msg',
} as const

export type PublicIdResource = keyof typeof PUBLIC_ID_PREFIXES
export type PublicIdPrefix = (typeof PUBLIC_ID_PREFIXES)[PublicIdResource]

/**
 * Generate a new public id for a resource, e.g. `org_7fj2k9pqrstu`.
 */
export function generatePublicId(resource: PublicIdResource): string {
  return `${PUBLIC_ID_PREFIXES[resource]}_${randomId()}`
}

/**
 * A public id is well-formed when it carries the expected prefix and a body of
 * the right length drawn from the alphabet. Returns the id unchanged when it
 * matches, or `null` when it does not — callers turn that into a 404 rather
 * than running a query that can only miss.
 */
export function parsePublicId(resource: PublicIdResource, value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const pattern = new RegExp(`^${PUBLIC_ID_PREFIXES[resource]}_[${ALPHABET}]{${ID_LENGTH}}$`)
  return pattern.test(value) ? value : null
}

/**
 * Route matcher for `:public_id` style params, so a malformed id never reaches
 * a controller. Use as `router.get('/lists/:id', …).where('id', publicIdMatcher('todoList'))`.
 */
export function publicIdMatcher(resource: PublicIdResource) {
  return {
    match: new RegExp(`^${PUBLIC_ID_PREFIXES[resource]}_[${ALPHABET}]{${ID_LENGTH}}$`),
  }
}
