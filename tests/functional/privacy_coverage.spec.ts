import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'

import privacy from '#privacy/registry'

/**
 * Every column that points at a user is accounted for by a privacy
 * contributor, or listed here with a reason (plan §22.4).
 *
 * This is the test that stops a new table quietly being left out of every
 * data export and every deletion. It reads the real schema, so a migration
 * that adds `reviewer_user_id` somewhere fails it the day it lands — with a
 * message saying which column, and that the fix is a contributor or a line
 * below.
 *
 * Functional rather than unit, because it needs the migrated database.
 */

/**
 * Columns that reference a user but hold nothing about them worth exporting
 * or erasing. Each needs its reason.
 */
const NOT_PERSONAL: Record<string, string> = {}

/**
 * The shapes a user reference takes in this schema. `owner_id` and
 * `actor_id` are named for their role rather than their target, so they are
 * listed by name.
 */
function referencesAUser(table: string, column: string) {
  return (
    /(^|_)user_id$/.test(column) ||
    (table === 'organizations' && column === 'owner_id') ||
    (table === 'audit_logs' && column === 'actor_id')
  )
}

test.group('Privacy coverage', () => {
  test('every column that references a user is covered', async ({ assert }) => {
    const connection = db.connection()
    const allTables = await connection.getAllTables(['public'])
    const tables = allTables.filter(
      (table) => !table.startsWith('adonis_') && !table.startsWith('sqlite_')
    )

    const covered = privacy.covered()
    const missing: string[] = []
    let found = 0

    for (const table of tables) {
      const columns = Object.keys(await connection.columnsInfo(table))

      for (const column of columns) {
        if (!referencesAUser(table, column)) {
          continue
        }

        found++
        const name = `${table}.${column}`

        if (!covered.has(name) && !(name in NOT_PERSONAL)) {
          missing.push(name)
        }
      }
    }

    assert.isAbove(found, 5, 'the schema was read')
    assert.deepEqual(
      missing,
      [],
      'these columns point at a user but no privacy contributor covers them — register one in start/privacy.ts, or add the column to NOT_PERSONAL with a reason'
    )
  })

  test('a contributor only claims columns that exist', async ({ assert }) => {
    const connection = db.connection()

    for (const name of privacy.covered()) {
      const [table, column] = name.split('.')
      const columns = Object.keys(await connection.columnsInfo(table))

      assert.include(columns, column, `${name} is claimed by a contributor but does not exist`)
    }
  })
})
