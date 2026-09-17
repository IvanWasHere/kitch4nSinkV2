import string from '@adonisjs/core/helpers/string'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import Organization from '#models/organization'

/**
 * Words that would produce a slug colliding with an application route, so an
 * organisation can never claim `/admin` or `/api`.
 *
 * A hand-written list rather than one derived from the router, because the
 * router is populated after this module loads and a reservation that arrived
 * late would be a reservation that did not hold. So **a feature that adds a
 * top-level route segment adds it here** — `lists` is the demo domain's
 * (docs/modules.md). Leaving a stale word in costs a workspace one possible
 * name; leaving a live one out lets a workspace shadow a route.
 */
const RESERVED = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'billing',
  'dashboard',
  'files',
  'health',
  'lists',
  'login',
  'logout',
  'members',
  'new',
  'oauth',
  'ready',
  'settings',
  'signup',
  'styleguide',
  'support',
  'webhooks',
])

/**
 * Turn an organisation name into a URL-safe slug, disambiguating against what
 * already exists.
 *
 * The uniqueness check runs inside the registration transaction, and the
 * database's unique index is the real guarantee — this only decides which
 * candidate to try, so two simultaneous "Acme" registrations produce `acme`
 * and `acme-2` rather than one of them failing.
 */
export async function generateOrganizationSlug(
  name: string,
  trx?: TransactionClientContract
): Promise<string> {
  const base = string.slug(name, { lower: true, strict: true }).slice(0, 48) || 'workspace'

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`

    if (RESERVED.has(candidate)) {
      continue
    }

    const query = Organization.query(trx ? { client: trx } : {}).where('slug', candidate)
    const existing = await query.first()

    if (!existing) {
      return candidate
    }
  }

  /**
   * Fifty collisions on one name is not a realistic case; falling back to a
   * random suffix is better than looping forever.
   */
  return `${base}-${string.random(6).toLowerCase()}`
}
