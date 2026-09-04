import { configApp } from '@adonisjs/eslint-config'

export default [
  /**
   * `database/schema.ts` is rewritten from the live database on every
   * `migration:run`, so formatting it is pointless — the next migration undoes
   * it, and a lint failure on a generated file is noise, not a defect.
   */
  { ignores: ['database/schema.ts', '.adonisjs/**'] },
  ...configApp(),
]
