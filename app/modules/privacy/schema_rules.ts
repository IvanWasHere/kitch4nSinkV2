import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

import { bigIntCounter, union } from '#database/schema_rules'

/**
 * How the Privacy module's table is generated into `database/schema.ts`.
 * Listed beside the core rules in `config/database.ts`, and removed with the
 * module (docs/modules.md).
 */
export default {
  tables: {
    privacy_requests: {
      columns: {
        type: union('export', 'deletion'),
        status: union(
          'requested',
          'confirmed',
          'approved',
          'processing',
          'completed',
          'failed',
          'rejected',
          'expired',
          'cancelled'
        ),
        export_size_bytes: bigIntCounter,
      },
    },
  },
} satisfies SchemaRules
