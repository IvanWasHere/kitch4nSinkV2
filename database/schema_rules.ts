import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

/**
 * How `database/schema.ts` is generated from the live database.
 *
 * The generator introspects columns and can only see their storage type — it
 * cannot know that `two_factor_secret` is encrypted, that `role` is a closed
 * set, or that a TEXT column on SQLite is JSON on Postgres. Everything the
 * type system should know beyond the storage type is declared here.
 *
 * This file is the reason `database/schema.ts` must never be hand-edited: it
 * is rewritten on every `migration:run`.
 */

const encrypted = {
  tsType: 'string',
  imports: [{ source: '#database/columns', namedImports: ['encryptedColumn'] }],
  decorators: [{ name: '@encryptedColumn' }],
}

const encryptedJson = (tsType: string) => ({
  tsType,
  imports: [{ source: '#database/columns', namedImports: ['encryptedJsonColumn'] }],
  decorators: [{ name: '@encryptedJsonColumn' }],
})

const json = (tsType: string) => ({
  tsType,
  imports: [{ source: '#database/columns', namedImports: ['jsonColumn'] }],
  decorators: [{ name: '@jsonColumn' }],
})

/**
 * SQLite stores booleans as 0/1 and Postgres as real booleans, so every
 * boolean column is read through a cast (portability rule 7).
 */
const boolean = {
  tsType: 'boolean',
  imports: [{ source: '#database/columns', namedImports: ['booleanColumn'] }],
  decorators: [{ name: '@booleanColumn' }],
}

const bigIntCounter = {
  tsType: 'number',
  imports: [{ source: '#database/columns', namedImports: ['bigIntColumn'] }],
  decorators: [{ name: '@bigIntColumn' }],
}

/**
 * A closed set of values stored as a string. Typing it as a union is what
 * turns a typo in `where('role', 'owners')` into a compile error.
 */
const union = (...values: string[]) => ({
  tsType: values.map((value) => `'${value}'`).join(' | '),
  imports: [],
  decorators: [{ name: '@column' }],
})

export default {
  columns: {
    /**
     * Encrypted wherever they appear — users and staff both carry them.
     */
    two_factor_secret: encrypted,
    two_factor_recovery_codes: encryptedJson('string[]'),
    access_token: encrypted,
  },

  tables: {
    organizations: {
      columns: {
        status: union('active', 'past_due', 'canceled', 'suspended'),
        storage_used_bytes: bigIntCounter,
        limit_overrides: json('Record<string, number | null>'),
      },
    },

    users: {
      columns: {
        role: union('owner', 'member'),
      },
    },

    staff_users: {
      columns: {
        role: union('admin', 'support'),
      },
    },

    social_accounts: {
      columns: {
        provider: union('google', 'github'),
      },
    },

    auth_tokens: {
      columns: {
        type: union('verify_email', 'reset_password'),
      },
    },

    invitations: {
      columns: {
        role: union('owner', 'member'),
      },
    },

    subscriptions: {
      columns: {
        provider: union('creem'),
        status: union('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired'),
        cancel_at_period_end: boolean,
      },
    },

    payments: {
      columns: {
        provider: union('creem'),
        status: union('succeeded', 'refunded', 'partially_refunded', 'disputed'),
      },
    },

    webhook_events: {
      columns: {
        provider: union('creem'),
        /**
         * The normalized event type (plan §7.2), not Creem's own — the ledger
         * records what we decided the event *meant*, so a replay applies the
         * same thing the live delivery did.
         */
        event_type: union(
          'subscription.activated',
          'subscription.updated',
          'subscription.trialing',
          'subscription.past_due',
          'subscription.paused',
          'subscription.canceled',
          'payment.succeeded',
          'payment.refunded',
          'dispute.created'
        ),
        payload: json('Record<string, any>'),
        signature_verified: boolean,
      },
    },

    audit_logs: {
      columns: {
        actor_type: union('user', 'staff', 'api_key', 'system'),
        metadata: json('Record<string, any>'),
      },
    },

    api_keys: {
      columns: {
        /**
         * The closed set from plan §11. A scope that is not in this union is
         * a compile error at every call site that checks one.
         */
        scopes: json(
          "('lists:read' | 'lists:write' | 'todos:read' | 'todos:write' | 'members:read')[]"
        ),
      },
    },

    files: {
      columns: {
        /**
         * The purpose disk, not the vendor — see `config/drive.ts`.
         */
        disk: union('private', 'public'),
        visibility: union('private', 'public'),
        size_bytes: bigIntCounter,
        attachable_type: union('User', 'Organization'),
      },
    },

    todo_lists: {
      columns: {
        /**
         * A design-token name — the `.card-stripe-*` palette — not a hex.
         */
        color: union('blue', 'green', 'orange', 'purple', 'red', 'gray'),
      },
    },

    todos: {
      columns: {
        priority: union('low', 'normal', 'high'),
      },
    },

    jobs: {
      columns: {
        /**
         * Typed loosely on purpose: each handler declares the shape it
         * expects, and the queue itself must be able to carry any of them.
         */
        payload: json('Record<string, any>'),
      },
    },
  },
} satisfies SchemaRules
