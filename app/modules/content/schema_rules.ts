import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

import { union } from '#database/schema_rules'

/**
 * How the Content module's tables are generated into `database/schema.ts`.
 * Listed beside the core rules in `config/database.ts`, and removed with the
 * module (docs/modules.md).
 */
export default {
  tables: {
    content_entries: {
      columns: {
        type: union('post', 'page'),
        status: union('draft', 'published', 'archived'),
      },
    },
  },
} satisfies SchemaRules
