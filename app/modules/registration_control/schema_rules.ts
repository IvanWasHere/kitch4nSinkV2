import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

import { boolean, union } from '#database/schema_rules'

/**
 * How Registration Control's table is generated into `database/schema.ts`.
 * Listed beside the core rules in `config/database.ts`, and removed with the
 * module (docs/modules.md).
 */
export default {
  tables: {
    waiting_list_entries: {
      columns: {
        status: union('pending_confirmation', 'confirmed', 'converted', 'cancelled'),
        double_opt_in_required: boolean,
      },
    },
  },
} satisfies SchemaRules
