import { createHash } from 'node:crypto'
import { customAlphabet } from 'nanoid'

/**
 * Generating and recognising API keys (plan §11).
 *
 * Format: `sk_live_<32 chars>` (or `sk_test_…`).
 *
 * The visible prefix is not decoration. A key pasted into a public repository
 * is found by secret scanners *because* of it, and `sk_live` vs `sk_test`
 * tells a customer at a glance which environment they are about to point a
 * script at — the single most expensive mistake an API key can cause.
 */

/**
 * Full alphanumerics, mixed case: this is a machine credential, never read
 * aloud, so entropy per character matters more than legibility. 62^32 is
 * ~190 bits.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const SECRET_LENGTH = 32

const randomSecret = customAlphabet(ALPHABET, SECRET_LENGTH)

export type ApiKeyEnvironment = 'live' | 'test'

/**
 * How much of the key is stored in the clear and shown in the UI.
 *
 * Covers the `sk_live_` marker plus four characters — enough for a customer
 * to tell two keys apart when deciding which to revoke, and far too little
 * to narrow a brute force meaningfully against 190 bits.
 */
export const PREFIX_LENGTH = 12

export interface GeneratedKey {
  /**
   * The only moment this value exists. It is returned to the caller, shown
   * once, and never stored or logged.
   */
  secret: string
  prefix: string
  hash: string
}

export function generateApiKey(environment: ApiKeyEnvironment = 'live'): GeneratedKey {
  const secret = `sk_${environment}_${randomSecret()}`

  return { secret, prefix: secret.slice(0, PREFIX_LENGTH), hash: hashApiKey(secret) }
}

/**
 * SHA-256, unsalted and fast on purpose.
 *
 * A key is 32 random characters, so there is no dictionary to attack and
 * nothing for a salt to defend against. A slow hash here would instead put
 * its cost on **every authenticated request** — bcrypt at sane parameters
 * would add ~100ms to a call that should take five.
 */
export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * Pull the key out of an `Authorization` header.
 *
 * Returns null for anything that is not a well-formed bearer token carrying
 * a key of ours — so a malformed header costs one string comparison rather
 * than a database lookup.
 */
export function parseAuthorizationHeader(header: string | undefined | null): string | null {
  if (!header) {
    return null
  }

  const match = header.match(/^Bearer\s+(\S+)$/i)

  if (!match) {
    return null
  }

  return looksLikeApiKey(match[1]) ? match[1] : null
}

export function looksLikeApiKey(value: string): boolean {
  return new RegExp(`^sk_(live|test)_[${ALPHABET}]{${SECRET_LENGTH}}$`).test(value)
}
