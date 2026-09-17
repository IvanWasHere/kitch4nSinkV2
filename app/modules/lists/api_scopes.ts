/**
 * The demo domain's API scopes (plan §11).
 *
 * The augmentation is what keeps `ApiScope` a closed literal union while the
 * scopes themselves belong to the feature: `requireScope(ctx, 'lists:write')`
 * in `#controllers/api/v1/list_controller` compiles because of this file, and
 * stops compiling when it is deleted — which is exactly the signal you want
 * when removing the domain (docs/modules.md).
 *
 * The descriptions live beside the augmentation so the pair cannot drift.
 * `start/api.ts` is what registers them.
 */

import type { ApiScope, ScopeDefinition } from '#api/scopes'

declare module '#api/scopes' {
  interface ApiScopes {
    'lists:read': true
    'lists:write': true
    'todos:read': true
    'todos:write': true
  }
}

/**
 * Tuples rather than an object, so the keys stay typed as `ApiScope` when
 * `start/api.ts` iterates them — `Object.entries` would widen them to
 * `string` and lose the one guarantee this file exists to provide.
 */
export const listApiScopes: [ApiScope, ScopeDefinition][] = [
  ['lists:read', { description: 'Read lists', default: true }],
  ['lists:write', { description: 'Create, rename, archive and delete lists' }],
  ['todos:read', { description: 'Read todos', default: true }],
  ['todos:write', { description: 'Create, edit, complete and delete todos' }],
]
