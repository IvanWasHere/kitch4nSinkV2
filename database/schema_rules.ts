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
  },
} satisfies SchemaRules
