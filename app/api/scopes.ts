/**
 * What an API key may do (plan §11).
 *
 * A key is **not a user**. It does not inherit the role of whoever created
 * it, so the API mirrors §6's owner/member split through scopes instead:
 * deleting a list needs `lists:write` explicitly, and a read-only key cannot
 * be talked into it by any sequence of requests.
 *
 * Keeping the list closed and typed means a scope check is a compile-time
 * question at every call site, not a string comparison that can drift.
 */
export const API_SCOPES = [
  'lists:read',
  'lists:write',
  'todos:read',
  'todos:write',
  'members:read',
] as const

export type ApiScope = (typeof API_SCOPES)[number]

/**
 * What a new key gets when the caller does not choose. Read-only across the
 * board: the safe default for something a customer is about to paste into a
 * script, and a deliberate second step to grant writes.
 */
export const DEFAULT_SCOPES: ApiScope[] = ['lists:read', 'todos:read', 'members:read']

/**
 * Human labels for the key-creation form. Written as what the integration
 * will be able to *do*, because "todos:write" is not a sentence a customer
 * can consent to.
 */
export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  'lists:read': 'Read lists',
  'lists:write': 'Create, rename, archive and delete lists',
  'todos:read': 'Read todos',
  'todos:write': 'Create, edit, complete and delete todos',
  'members:read': 'Read the member directory (needed to assign todos)',
}

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value)
}

/**
 * Keep only the scopes we recognise, de-duplicated and in a stable order.
 *
 * Order matters for nothing but the UI and the tests; stability is what makes
 * the stored JSON comparable.
 */
export function normalizeScopes(values: unknown): ApiScope[] {
  if (!Array.isArray(values)) {
    return []
  }

  return API_SCOPES.filter((scope) => values.includes(scope))
}
