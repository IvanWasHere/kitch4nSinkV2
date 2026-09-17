/**
 * What an API key may do (plan §11).
 *
 * A key is **not a user**. It does not inherit the role of whoever created
 * it, so the API mirrors §6's owner/member split through scopes instead:
 * deleting a resource needs an explicit `:write` scope, and a read-only key
 * cannot be talked into it by any sequence of requests.
 *
 * Scopes are **registered** rather than listed here, because the endpoints
 * they guard belong to features: the demo domain's `lists:*` and `todos:*`
 * leave with it, and a feature you add brings its own (docs/modules.md).
 * Every scope this application has is registered in `start/api.ts`.
 *
 * The list stays **closed and typed** all the same, which is the whole point
 * of the original design — a scope check must be a compile-time question at
 * every call site, not a string comparison that can drift. That is what the
 * `ApiScopes` interface below is for: a feature augments it, `ApiScope` stays
 * a literal union assembled across files, and `requireScope(ctx, 'lists:read')`
 * still fails to compile on a typo.
 */

/**
 * The type-level scope registry. A feature adds to it by augmentation:
 *
 * ```ts
 * declare module '#api/scopes' {
 *   interface ApiScopes {
 *     'projects:read': true
 *     'projects:write': true
 *   }
 * }
 * ```
 *
 * `registerScope` only accepts an `ApiScope`, so a registration with no
 * matching augmentation is a compile error. The other direction — an
 * augmentation nobody registers — is caught by `tests/unit/api.spec.ts`,
 * which asserts the two agree.
 */
export interface ApiScopes {
  /**
   * Reading the member directory. Core: members exist whatever the product
   * is, and an integration needs them to resolve an assignee.
   */
  'members:read': true
}

export type ApiScope = keyof ApiScopes & string

export interface ScopeDefinition {
  /**
   * Written as what the integration will be able to *do*, for the
   * key-creation form — "todos:write" is not a sentence a customer can
   * consent to.
   */
  description: string

  /**
   * Whether a key that does not choose its scopes gets this one.
   *
   * Only ever a read scope. The safe default for something a customer is
   * about to paste into a script, and a deliberate second step to grant
   * writes.
   */
  default?: boolean
}

export class ScopeRegistry {
  #scopes = new Map<ApiScope, ScopeDefinition>()

  /**
   * Register a scope, or replace one already registered under the same name.
   *
   * Insertion order is preserved and is the order scopes are offered in the
   * key-creation form, listed in the OpenAPI document, and stored on a key —
   * order means nothing to enforcement, but a stable one is what makes the
   * stored JSON comparable between two keys.
   */
  register(scope: ApiScope, definition: ScopeDefinition): this {
    this.#scopes.set(scope, definition)
    return this
  }

  all(): ApiScope[] {
    return [...this.#scopes.keys()]
  }

  /**
   * What a new key gets when the caller does not choose.
   */
  defaults(): ApiScope[] {
    return this.all().filter((scope) => this.#scopes.get(scope)?.default)
  }

  describe(scope: ApiScope): string {
    return this.#scopes.get(scope)?.description ?? scope
  }

  /**
   * Every scope with its description, for the form and the docs.
   */
  entries(): { scope: ApiScope; description: string }[] {
    return this.all().map((scope) => ({ scope, description: this.describe(scope) }))
  }

  has(value: unknown): value is ApiScope {
    return typeof value === 'string' && this.#scopes.has(value as ApiScope)
  }

  /**
   * Keep only the scopes we recognise, de-duplicated and in registration
   * order.
   *
   * Filtering the *registry* rather than the input is what does the
   * de-duplicating and the ordering in one step, and it means an unknown
   * string is dropped rather than stored — a key can never hold a scope
   * nothing checks.
   */
  normalize(values: unknown): ApiScope[] {
    if (!Array.isArray(values)) {
      return []
    }

    return this.all().filter((scope) => values.includes(scope))
  }

  /**
   * Drop every registration — for a test that needs the registry empty, and
   * for an application replacing the set wholesale.
   */
  reset(): this {
    this.#scopes.clear()
    return this
  }
}

export default new ScopeRegistry()
