import router from '@adonisjs/core/services/router'
import string from '@adonisjs/core/helpers/string'

/**
 * What a slug may look like: lowercase words joined by single hyphens.
 * Nothing that needs escaping, nothing that could be read as a path.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const SLUG_MAX_LENGTH = 120

/**
 * Directories served from `public/` before the router runs. A page called
 * `assets` would be shadowed by the static server without the router ever
 * being asked, so these are reserved by hand — they are the one thing the
 * route table cannot tell us.
 */
const STATIC_SEGMENTS = ['assets']

/**
 * Every top-level path segment something else already answers (plan §22.6,
 * D13). Read from the router on each call rather than written down, so a
 * route added next year is reserved the day it is added and nobody keeps a
 * list in step by hand.
 *
 * Only the *first* segment of each pattern matters: pages live at `/:slug`,
 * one segment deep. Parameter segments (`/:slug` itself) reserve nothing.
 */
export function reservedSlugs(): Set<string> {
  const reserved = new Set(STATIC_SEGMENTS)

  for (const routes of Object.values(router.toJSON())) {
    for (const route of routes) {
      const first = route.pattern.split('/').find(Boolean)

      if (first && !first.startsWith(':') && first !== '*') {
        reserved.add(first.toLowerCase())
      }
    }
  }

  return reserved
}

export function isReservedSlug(slug: string): boolean {
  return reservedSlugs().has(slug)
}

/**
 * A slug from a title: "Hello, World!" → `hello-world`. Falls back to
 * `untitled` for a title with nothing slug-shaped in it.
 */
export function slugify(title: string): string {
  return (
    string
      .slug(title, { lower: true, strict: true })
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, SLUG_MAX_LENGTH - 4)
      .replace(/-$/, '') || 'untitled'
  )
}
