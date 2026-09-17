import string from '@adonisjs/core/helpers/string'

import env from '#start/env'

import scopes from '#api/scopes'
import quotas from '#billing/quotas'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '#api/cursor'
import { BURST_REQUESTS, BURST_WINDOW } from '#middleware/api_rate_limit'

/**
 * The OpenAPI document (plan §11).
 *
 * Written by hand from the transformers and validators rather than generated
 * by reflection. The point of a published spec is that it is the *contract*,
 * and a generated one silently changes shape the moment somebody adds a
 * column — which is the exact failure the transformers exist to prevent. If
 * this file and a transformer disagree, that is a bug the schema test catches.
 *
 * The `402` behaviour is documented on every create, prominently, because it
 * is the one genuinely unusual thing here: integrations treat a non-2xx as
 * retryable by default, and retrying a quota block forever is the worst
 * possible reading.
 */

export const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          description: 'Stable machine code. Branch on this, never on the message.',
        },
        message: { type: 'string' },
        details: {},
      },
    },
  },
} as const

const memberSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'usr_7fj2k9pqrstu' },
    name: { type: 'string', nullable: true },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['owner', 'member'] },
  },
} as const

export const quotaSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', nullable: true, description: 'null means unlimited.' },
    used: { type: 'integer', nullable: true },
    remaining: { type: 'integer', nullable: true },
  },
} as const

export const cursorParams = [
  {
    name: 'cursor',
    in: 'query',
    schema: { type: 'string' },
    description: 'From a previous response’s meta.next_cursor. Omit for the first page.',
  },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', default: DEFAULT_PAGE_SIZE, maximum: MAX_PAGE_SIZE },
    description: `Clamped to ${MAX_PAGE_SIZE}. Asking for more is not an error.`,
  },
] as const

export function page(itemSchema: unknown) {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: itemSchema },
      meta: {
        type: 'object',
        properties: {
          next_cursor: {
            type: 'string',
            nullable: true,
            description: 'null on the last page. This is how a sync knows it is finished.',
          },
          limit: { type: 'integer' },
        },
      },
    },
  }
}

export function item(itemSchema: unknown) {
  return { type: 'object', properties: { data: itemSchema } }
}

export function json(schema: unknown) {
  return { content: { 'application/json': { schema } } }
}

/**
 * Responses every endpoint can produce. Spelled out once and referenced, so
 * a new endpoint cannot forget to document the ones that matter.
 */
export const commonResponses = {
  401: { description: 'Missing, unknown, revoked or expired key.', ...json(errorSchema) },
  403: { description: 'The key lacks the required scope.', ...json(errorSchema) },
  404: { description: 'No such resource in this organisation.', ...json(errorSchema) },
  429: { description: 'Rate limited. See Retry-After.', ...json(errorSchema) },
}

export const planLimitResponse = {
  402: {
    description:
      'Plan limit reached. **A stop signal, not a retryable error** — retrying will fail identically until the customer upgrades or frees a slot. error.details carries limit, allowed, current and upgrade_url. Call GET /organization first to size a bulk import.',
    ...json(errorSchema),
  },
}

/**
 * What a feature adds to the document.
 *
 * `schemas` land under `components.schemas`; `paths` are merged in after
 * core's. Both are plain OpenAPI fragments — there is no wrapper type to
 * learn, because the spec *is* the contract and hiding it behind a builder is
 * how a published interface starts drifting from what it describes.
 */
export interface OpenApiContribution {
  schemas?: Record<string, unknown>
  paths?: Record<string, unknown>
}

export class OpenApiRegistry {
  #contributions: OpenApiContribution[] = []

  register(contribution: OpenApiContribution): this {
    this.#contributions.push(contribution)
    return this
  }

  schemas(): Record<string, unknown> {
    return Object.assign({}, ...this.#contributions.map((entry) => entry.schemas ?? {}))
  }

  paths(): Record<string, unknown> {
    return Object.assign({}, ...this.#contributions.map((entry) => entry.paths ?? {}))
  }

  reset(): this {
    this.#contributions = []
    return this
  }
}

export const openApi = new OpenApiRegistry()

export function openApiDocument() {
  const server = `${env.get('APP_URL')}/api/v1`

  return {
    'openapi': '3.1.0',
    'info': {
      title: `${env.get('APP_NAME', 'Acme')} API`,
      version: '1.0.0',
      description: [
        'Organisation-scoped JSON API.',
        '',
        '**The key is the scope.** No endpoint accepts an organisation id — an API key',
        'identifies the workspace, so there is nothing to pass and nothing to forge.',
        '',
        '**A 402 is a stop signal.** Any endpoint that creates something returns 402 with',
        '`plan_limit_exceeded` when the workspace is at a plan limit. Do not retry it:',
        'call `GET /organization` first, size your batch to `usage.*.remaining`, and treat a',
        '402 mid-batch as "stop and tell the customer", not as a failure to back off from.',
      ].join('\n'),
    },
    'servers': [{ url: server }],

    'components': {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: [
            'An organisation API key: `Authorization: Bearer sk_live_…`.',
            'Created by the workspace owner and shown once. Scopes:',
            ...scopes.entries().map(({ scope, description }) => `- \`${scope}\` — ${description}`),
          ].join('\n'),
        },
      },
      schemas: {
        Error: errorSchema,
        Member: memberSchema,
        Quota: quotaSchema,
        ...openApi.schemas(),
      },
    },

    'security': [{ apiKey: [] }],

    'paths': {
      '/organization': {
        get: {
          summary: 'Plan, limits and current usage',
          description:
            'Call this before a bulk import. `usage.*.remaining` is how much headroom there is; `null` means unlimited.',
          responses: {
            200: {
              description: 'The calling key’s workspace.',
              ...json(
                item({
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    timezone: { type: 'string' },
                    plan: {
                      type: 'object',
                      properties: {
                        key: { type: 'string' },
                        name: { type: 'string' },
                        features: { type: 'array', items: { type: 'string' } },
                      },
                    },
                    /**
                     * Built from the quota registry, exactly as
                     * `OrganizationTransformer` builds the payload it
                     * documents — so the two cannot disagree about which
                     * quotas exist.
                     */
                    usage: {
                      type: 'object',
                      properties: Object.fromEntries(
                        quotas.all().map((quota) => [string.snakeCase(quota.key), quotaSchema])
                      ),
                    },
                  },
                })
              ),
            },
            ...commonResponses,
          },
        },
      },

      '/members': {
        get: {
          summary: 'List members',
          description: 'For resolving a name to an id you may set as `assigned_to`.',
          parameters: [...cursorParams],
          responses: {
            200: { description: 'A page of members.', ...json(page(memberSchema)) },
            ...commonResponses,
          },
        },
      },

      /**
       * Whatever the features registered in `start/api.ts` document, after
       * core's own endpoints.
       */
      ...openApi.paths(),
    },

    'x-rate-limits': {
      burst: `${BURST_REQUESTS} requests per ${BURST_WINDOW}, per key. Headers: x-ratelimit-limit / -remaining / -reset.`,
      monthly:
        'The plan’s apiCallsPerMonth, per organisation, resetting on the 1st. Headers: x-quota-limit / -remaining / -reset.',
    },
  }
}
