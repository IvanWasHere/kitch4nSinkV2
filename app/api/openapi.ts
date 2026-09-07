import env from '#start/env'

import { API_SCOPES, SCOPE_DESCRIPTIONS } from '#api/scopes'
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

const errorSchema = {
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

const listSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'lst_7fj2k9pqrstu' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    color: { type: 'string', enum: ['blue', 'green', 'orange', 'purple', 'red', 'gray'] },
    position: { type: 'integer' },
    todos_count: {
      type: 'integer',
      description:
        'Counts completed todos too. This is the number the todosPerList limit is checked against.',
    },
    archived: { type: 'boolean' },
    archived_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time', nullable: true },
  },
} as const

const todoSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'tdo_7fj2k9pqrstu' },
    list_id: { type: 'string', example: 'lst_7fj2k9pqrstu' },
    title: { type: 'string' },
    notes: { type: 'string', nullable: true },
    priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    position: { type: 'integer' },
    due_at: { type: 'string', format: 'date-time', nullable: true },
    completed: { type: 'boolean' },
    completed_at: { type: 'string', format: 'date-time', nullable: true },
    assigned_to: {
      type: 'string',
      nullable: true,
      description: "A member's id. An id from another organisation is a 422, never a silent null.",
    },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time', nullable: true },
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

const quotaSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', nullable: true, description: 'null means unlimited.' },
    used: { type: 'integer', nullable: true },
    remaining: { type: 'integer', nullable: true },
  },
} as const

const cursorParams = [
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

function page(itemSchema: unknown) {
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

function item(itemSchema: unknown) {
  return { type: 'object', properties: { data: itemSchema } }
}

function json(schema: unknown) {
  return { content: { 'application/json': { schema } } }
}

/**
 * Responses every endpoint can produce. Spelled out once and referenced, so
 * a new endpoint cannot forget to document the ones that matter.
 */
const commonResponses = {
  401: { description: 'Missing, unknown, revoked or expired key.', ...json(errorSchema) },
  403: { description: 'The key lacks the required scope.', ...json(errorSchema) },
  404: { description: 'No such resource in this organisation.', ...json(errorSchema) },
  429: { description: 'Rate limited. See Retry-After.', ...json(errorSchema) },
}

const planLimitResponse = {
  402: {
    description:
      'Plan limit reached. **A stop signal, not a retryable error** — retrying will fail identically until the customer upgrades or frees a slot. error.details carries limit, allowed, current and upgrade_url. Call GET /organization first to size a bulk import.',
    ...json(errorSchema),
  },
}

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
        '**A 402 is a stop signal.** `POST /lists` and `POST /lists/{id}/todos` return 402',
        'with `plan_limit_exceeded` when the workspace is at a plan limit. Do not retry it:',
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
            ...API_SCOPES.map((scope) => `- \`${scope}\` — ${SCOPE_DESCRIPTIONS[scope]}`),
          ].join('\n'),
        },
      },
      schemas: {
        Error: errorSchema,
        List: listSchema,
        Todo: todoSchema,
        Member: memberSchema,
        Quota: quotaSchema,
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
                    usage: {
                      type: 'object',
                      properties: {
                        lists: quotaSchema,
                        seats: quotaSchema,
                        storage_mb: quotaSchema,
                        todos_per_list: quotaSchema,
                      },
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

      '/lists': {
        get: {
          summary: 'List lists',
          parameters: [
            ...cursorParams,
            {
              name: 'archived',
              in: 'query',
              schema: { type: 'string', enum: ['true', 'false', 'all'] },
              description: 'Omit for live lists only. Archived lists still count against quota.',
            },
          ],
          responses: {
            200: { description: 'A page of lists.', ...json(page(listSchema)) },
            ...commonResponses,
          },
        },
        post: {
          summary: 'Create a list',
          requestBody: json({
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', maxLength: 120 },
              description: { type: 'string', nullable: true, maxLength: 500 },
              color: listSchema.properties.color,
            },
          }),
          responses: {
            201: { description: 'Created.', ...json(item(listSchema)) },
            422: { description: 'Invalid body, or a duplicate name.', ...json(errorSchema) },
            ...planLimitResponse,
            ...commonResponses,
          },
        },
      },

      '/lists/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          summary: 'Fetch a list',
          responses: {
            200: { description: 'The list.', ...json(item(listSchema)) },
            ...commonResponses,
          },
        },
        patch: {
          summary: 'Update a list',
          description: 'Archiving is a field here, so a rename and an archive are one call.',
          requestBody: json({
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 120 },
              description: { type: 'string', nullable: true, maxLength: 500 },
              color: listSchema.properties.color,
              archived: { type: 'boolean' },
            },
          }),
          responses: {
            200: { description: 'The updated list.', ...json(item(listSchema)) },
            422: { description: 'Invalid body, or a duplicate name.', ...json(errorSchema) },
            ...commonResponses,
          },
        },
        delete: {
          summary: 'Delete a list and its todos',
          description:
            'Soft delete, and it frees quota. Requires `lists:write` — a read-only key cannot do this by any route.',
          responses: { 204: { description: 'Deleted.' }, ...commonResponses },
        },
      },

      '/lists/{id}/todos': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          summary: 'List todos in a list',
          parameters: [
            ...cursorParams,
            { name: 'completed', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
            {
              name: 'assigned_to',
              in: 'query',
              schema: { type: 'string' },
              description: 'A member id. An unknown id matches nothing rather than erroring.',
            },
          ],
          responses: {
            200: { description: 'A page of todos.', ...json(page(todoSchema)) },
            ...commonResponses,
          },
        },
        post: {
          summary: 'Create a todo',
          description:
            'Completed todos still count against `todosPerList`, so a full list stays full until todos are deleted or moved.',
          requestBody: json({
            type: 'object',
            required: ['title'],
            properties: {
              title: { type: 'string', maxLength: 200 },
              notes: { type: 'string', nullable: true, maxLength: 2000 },
              priority: todoSchema.properties.priority,
              due_at: { type: 'string', format: 'date-time', nullable: true },
              assigned_to: { type: 'string', nullable: true },
            },
          }),
          responses: {
            201: { description: 'Created.', ...json(item(todoSchema)) },
            422: {
              description: 'Invalid body, or an `assigned_to` outside this organisation.',
              ...json(errorSchema),
            },
            ...planLimitResponse,
            ...commonResponses,
          },
        },
      },

      '/todos/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          summary: 'Fetch a todo',
          responses: {
            200: { description: 'The todo.', ...json(item(todoSchema)) },
            ...commonResponses,
          },
        },
        patch: {
          summary: 'Update a todo',
          requestBody: json({
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: 200 },
              notes: { type: 'string', nullable: true, maxLength: 2000 },
              priority: todoSchema.properties.priority,
              due_at: { type: 'string', format: 'date-time', nullable: true },
              assigned_to: { type: 'string', nullable: true },
              position: { type: 'integer', minimum: 0 },
            },
          }),
          responses: {
            200: { description: 'The updated todo.', ...json(item(todoSchema)) },
            422: { description: 'Invalid body.', ...json(errorSchema) },
            ...commonResponses,
          },
        },
        delete: {
          summary: 'Delete a todo',
          description: 'Soft delete. Frees a slot against `todosPerList`.',
          responses: { 204: { description: 'Deleted.' }, ...commonResponses },
        },
      },

      '/todos/{id}/complete': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        post: {
          summary: 'Mark a todo complete',
          description:
            'Records who completed it and when. Idempotent — completing a done todo succeeds.',
          responses: {
            200: { description: 'The todo.', ...json(item(todoSchema)) },
            ...commonResponses,
          },
        },
      },

      '/todos/{id}/uncomplete': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        post: {
          summary: 'Mark a todo not complete',
          responses: {
            200: { description: 'The todo.', ...json(item(todoSchema)) },
            ...commonResponses,
          },
        },
      },
    },

    'x-rate-limits': {
      burst: `${BURST_REQUESTS} requests per ${BURST_WINDOW}, per key. Headers: x-ratelimit-limit / -remaining / -reset.`,
      monthly:
        'The plan’s apiCallsPerMonth, per organisation, resetting on the 1st. Headers: x-quota-limit / -remaining / -reset.',
    },
  }
}
