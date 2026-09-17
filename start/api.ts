/*
|--------------------------------------------------------------------------
| The organisation API's surface
|--------------------------------------------------------------------------
|
| Every scope a key can hold and every endpoint the published spec describes
| (plan §11).
|
| Both are registered rather than listed in `app/`, because the endpoints
| they describe belong to features. `app/api/scopes.ts` owns what a scope
| *is* and how one is checked; `app/api/openapi.ts` owns the document's shape
| and the shared fragments; neither knows what this application actually
| serves.
|
| Scope order is the order they are offered on the key-creation form, listed
| in the spec, and stored on a key. It means nothing to enforcement, but a
| stable order is what makes two keys' stored JSON comparable.
|
| **Removing a feature means deleting its block here** — see
| `docs/modules.md`. The form, the spec, `/docs`, the key validator and the
| scope check all read the registry, so nothing else changes.
|
*/

import scopes from '#api/scopes'
import { openApi } from '#api/openapi'
import { listApiScopes } from '#todos/api_scopes'
import { listOpenApi } from '#todos/openapi'

/**
 * The demo domain (D8) — delete with it.
 *
 * `listApiScopes` carries the type augmentation that puts `lists:*` and
 * `todos:*` into `ApiScope`, so deleting the file is what makes a leftover
 * `requireScope(ctx, 'lists:read')` stop compiling rather than fail at
 * runtime.
 */
for (const [scope, definition] of listApiScopes) {
  scopes.register(scope, definition)
}

openApi.register(listOpenApi)

/**
 * Core scopes, last, because `members:read` reads last on the form.
 *
 * Members exist whatever the product is, and an integration needs them to
 * resolve an assignee — so this one does not belong to a feature.
 */
scopes.register('members:read', {
  description: 'Read the member directory (needed to assign todos)',
  default: true,
})
