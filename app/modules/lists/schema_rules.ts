import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

import { union } from '#database/schema_rules'

/**
 * How the demo domain's tables are generated into `database/schema.ts`.
 *
 * Its own file, listed beside the core rules in `config/database.ts`, because
 * the generator introspects storage types and cannot know that `color` is a
 * closed set — and because a table that leaves with its feature should take
 * its rules with it rather than leaving them behind in a core file
 * (docs/modules.md).
 *
 * The generator deep merges every path in `rulesPaths`, so this adds tables
 * without replacing anything.
 */
export default {
  tables: {
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
  },
} satisfies SchemaRules
