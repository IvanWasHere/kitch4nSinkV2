import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

/**
 * The object key convention (plan §10):
 *
 *   orgs/{organization_public_id}/{yyyy}/{mm}/{uuid}.{ext}
 *
 * **Tenant prefix first**, which is the part that matters. It makes a
 * bucket-level policy per tenant expressible, makes "export everything this
 * customer has" a prefix listing, and makes an accidental cross-tenant read
 * visible in the key itself rather than hidden behind a database column.
 *
 * The date segments keep any single prefix small enough for a listing to
 * remain useful years in.
 */
export const ALLOWED_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'txt',
  'csv',
] as const

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number]

export function buildObjectKey(input: {
  organizationPublicId: string
  extension: string
  at?: DateTime
}): string {
  const at = input.at ?? DateTime.utc()
  const year = at.toUTC().toFormat('yyyy')
  const month = at.toUTC().toFormat('MM')

  /**
   * A random UUID, never the client's filename. Drive's `move()` defaults to
   * this for a reason (CVE-2026-21440): a filename from a request can carry
   * path traversal, a second extension, or somebody else's key.
   *
   * The original name is kept in the database column for display, and only
   * for display.
   */
  const name = `${randomUUID()}${input.extension ? `.${input.extension}` : ''}`

  return `orgs/${input.organizationPublicId}/${year}/${month}/${name}`
}

/**
 * The prefix holding everything one organisation has ever uploaded — the
 * whole point of putting the tenant first.
 */
export function organizationPrefix(organizationPublicId: string): string {
  return `orgs/${organizationPublicId}/`
}

/**
 * Whether a key belongs to an organisation.
 *
 * A second line of defence, not the first: every query already filters on
 * `organization_id`. This catches the case where a key reaches storage from
 * somewhere a tenant filter did not run.
 */
export function keyBelongsTo(key: string, organizationPublicId: string): boolean {
  return key.startsWith(organizationPrefix(organizationPublicId))
}

/**
 * The extension we will store a file under, lowercased and normalised.
 *
 * Taken from the client's filename only to *choose among* the allowlist —
 * never to build the key. Anything not on the list returns null and the
 * upload is refused.
 */
export function normalizeExtension(filename: string): AllowedExtension | null {
  const match = filename.match(/\.([a-z0-9]+)$/i)

  if (!match) {
    return null
  }

  const extension = match[1].toLowerCase()
  const canonical = extension === 'jpe' ? 'jpg' : extension

  return (ALLOWED_EXTENSIONS as readonly string[]).includes(canonical)
    ? (canonical as AllowedExtension)
    : null
}
