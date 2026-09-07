import { column } from '@adonisjs/lucid/orm'
import encryption from '@adonisjs/core/services/encryption'

/**
 * Column decorators used by the generated schema classes.
 *
 * `database/schema.ts` is regenerated from the live database on every
 * migration run, so anything a column needs beyond a plain value — encryption,
 * JSON round-tripping, dialect differences — has to be expressible as a
 * decorator that `database/schema_rules.ts` can point at. That is what these
 * are.
 */

/**
 * A JSON column.
 *
 * Lucid stores JSON as TEXT on SQLite and as `json` on Postgres, and hands the
 * value back differently on each. Round-tripping through an explicit
 * prepare/consume pair is what makes the two identical (plan §5.1, rule 2).
 */
export function jsonColumn() {
  return column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) => {
      if (value === null || value === undefined) {
        return null
      }
      return typeof value === 'string' ? JSON.parse(value) : value
    },
  })
}

/**
 * A column whose value is encrypted at rest with the application key, so the
 * database only ever holds ciphertext. Used for TOTP secrets and OAuth
 * tokens — anything that would be immediately usable if a backup leaked.
 *
 * Never serialised: an encrypted value has no business in an API response.
 */
export function encryptedColumn() {
  return column({
    serializeAs: null,
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : encryption.encrypt(String(value)),
    consume: (value: unknown) =>
      value === null || value === undefined ? null : encryption.decrypt<string>(String(value)),
  })
}

/**
 * An encrypted column holding JSON — the two-factor recovery codes.
 */
export function encryptedJsonColumn() {
  return column({
    serializeAs: null,
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : encryption.encrypt(JSON.stringify(value)),
    consume: (value: unknown) => {
      if (value === null || value === undefined) {
        return null
      }

      const decrypted = encryption.decrypt<string>(String(value))
      return decrypted === null ? null : JSON.parse(decrypted)
    },
  })
}

/**
 * A bigint column read back as a number.
 *
 * `pg` returns bigints as strings to avoid losing precision past 2^53, while
 * SQLite returns numbers. Byte counters never approach that ceiling, so
 * coercing here is what keeps `storageUsedBytes + size` from silently becoming
 * string concatenation on Postgres only.
 */
export function bigIntColumn() {
  return column({
    consume: (value: unknown) => (value === null || value === undefined ? 0 : Number(value)),
  })
}

/**
 * A boolean column, normalised across engines.
 *
 * SQLite has no boolean type and hands back `0`/`1`; Postgres returns real
 * booleans. Without this, `assert.isTrue(row.flag)` passes on one engine and
 * fails on the other, and — worse — `if (row.flag)` quietly agrees while
 * `row.flag === true` does not (portability rule 7).
 */
export function booleanColumn() {
  return column({
    prepare: (value: unknown) => (value === null || value === undefined ? value : Boolean(value)),
    consume: (value: unknown) => (value === null || value === undefined ? value : Boolean(value)),
  })
}
