/**
 * Cursor pagination (plan §11).
 *
 * Offset pagination breaks under concurrent writes: something inserted before
 * page 2 is fetched shifts every row down, so the client sees a duplicate,
 * and something deleted makes it skip a row entirely. A customer syncing
 * their tasks would silently miss records — the failure mode that makes an
 * integration untrustworthy without ever erroring.
 *
 * A cursor is the last row's primary key. It is opaque on purpose: base64 of
 * an internal id, so nothing about our numbering becomes part of the public
 * contract and a client cannot hand-craft one to walk another tenant's rows
 * (the query is scoped by organisation regardless).
 */
export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

export function encodeCursor(id: number): string {
  return Buffer.from(`id:${id}`, 'utf8').toString('base64url')
}

/**
 * Returns null for anything that is not one of our cursors — a garbage cursor
 * is treated as "start from the beginning" rather than as an error, because
 * the alternative is a sync loop that dies on a truncated query string.
 */
export function decodeCursor(cursor: string | undefined | null): number | null {
  if (!cursor) {
    return null
  }

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    const match = decoded.match(/^id:(\d+)$/)

    if (!match) {
      return null
    }

    const id = Number(match[1])
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

/**
 * The page size a request asked for, clamped.
 *
 * A cap rather than an error: a client asking for 10,000 rows wants as many
 * as it can get, and failing the request teaches it nothing the response
 * headers would not.
 */
export function pageSize(value: unknown): number {
  const requested = Number(value)

  if (!Number.isFinite(requested) || requested < 1) {
    return DEFAULT_PAGE_SIZE
  }

  return Math.min(Math.floor(requested), MAX_PAGE_SIZE)
}

export interface CursorPage<T> {
  rows: T[]
  nextCursor: string | null
}

/**
 * Turn `limit + 1` rows into a page and the cursor that follows it.
 *
 * Fetching one extra row is how "is there a next page?" is answered without a
 * second `COUNT(*)` — and a `next_cursor` of null is the only reliable signal
 * a syncing client has that it is done.
 */
export function toCursorPage<T extends { id: number }>(rows: T[], limit: number): CursorPage<T> {
  if (rows.length <= limit) {
    return { rows, nextCursor: null }
  }

  const page = rows.slice(0, limit)

  return { rows: page, nextCursor: encodeCursor(page[page.length - 1].id) }
}
