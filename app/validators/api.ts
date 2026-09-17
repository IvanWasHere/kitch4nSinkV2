import vine from '@vinejs/vine'

import scopes from '#api/scopes'

/**
 * Request bodies for the organisation API (plan §11) that core owns.
 *
 * A feature's own API bodies live with the feature — the list and todo ones
 * are in `#modules/lists/validators` — so that removing it takes its
 * validators with it (docs/modules.md). What stays here is the API's own
 * surface.
 */

/**
 * Creating a key from the owner's own screen (not from the API — a key
 * cannot mint another key).
 */
export const createApiKeyValidator = vine.create({
  name: vine.string().trim().minLength(1).maxLength(80),

  /**
   * The choices are read **lazily**, per validation, rather than captured
   * when this module loads: scopes are registered in `start/api.ts` and this
   * file is imported by a controller, so a snapshot taken here could be
   * taken before the registry is filled.
   */
  scopes: vine
    .array(vine.enum(() => scopes.all()))
    .minLength(1)
    .optional(),
  environment: vine.enum(['live', 'test'] as const).optional(),
})
