import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import type User from '#models/user'
import type { StorageDisk } from '#storage/contracts'

/**
 * A stored file to copy into an export, under `files/` in the archive.
 */
export interface PrivacyExportFile {
  /**
   * Its name inside the archive, relative to `files/`. Must be unique within
   * one export; prefixing with the file's public id is the usual way.
   */
  path: string
  disk: StorageDisk
  key: string
}

export interface PrivacyEraseContext {
  /**
   * Whether the user was the last remaining member of their workspace —
   * decided once, inside the deletion's transaction, and handed to every
   * contributor so they cannot disagree about it (plan §22.8.2).
   */
  lastMember: boolean
  trx: TransactionClientContract

  /**
   * The address the person had before their row was overwritten — for data
   * that is keyed by email rather than by user id, like a waiting-list
   * entry. By the time `erase` runs, `user.email` is already the deleted
   * placeholder.
   */
  originalEmail: string

  /**
   * Work that must only happen once the database changes have committed —
   * deleting a stored object, say. Deleting it inside the transaction and
   * then rolling back would leave a row pointing at nothing.
   */
  afterCommit(work: () => Promise<void>): void
}

/**
 * One feature's share of a person's data (plan §22.4, §22.8).
 *
 * Privacy asks the registry, never a table: the lists module knows what a
 * todo is, the privacy module does not and must not. A feature that stores
 * something about a user registers a contributor beside its other
 * registrations, and both the export and the deletion pick it up.
 */
export interface PrivacyContributor {
  /**
   * The section name in `data.json`. Stable — it is what a person reading
   * their export, or a script processing it, keys on.
   */
  key: string

  /**
   * One line for the export's README: what this section holds.
   */
  describes: string

  /**
   * What is deliberately left out, and why — said in the README rather
   * than left for somebody to wonder about.
   */
  excludes?: string

  /**
   * Every `table.column` that points at a user and that this contributor
   * accounts for, exported or not. `tests/unit/privacy_coverage.spec.ts`
   * fails when a column referencing users is covered by nobody, which is
   * what keeps a new table from quietly being left out of every export and
   * every deletion.
   */
  covers: string[]

  /**
   * This user's rows, as plain JSON. An explicit allowlist of fields — never
   * a model's `serialize()`, which would export whatever column is added next,
   * secrets included. `null` leaves the section out.
   */
  export(user: User): Promise<unknown>

  /**
   * Stored files whose *contents* belong in the export.
   */
  files?(user: User): Promise<PrivacyExportFile[]>

  /**
   * Delete or anonymise this contributor's rows for a user whose deletion
   * was approved (plan §22.8.4). Must tolerate rows that are already gone —
   * a failed deletion is retried from the start.
   */
  erase?(user: User, context: PrivacyEraseContext): Promise<void>
}

export class PrivacyRegistry {
  #contributors: PrivacyContributor[] = []

  register(contributor: PrivacyContributor): this {
    if (this.#contributors.some((existing) => existing.key === contributor.key)) {
      throw new Error(`A privacy contributor named "${contributor.key}" is already registered`)
    }

    this.#contributors.push(contributor)
    return this
  }

  /**
   * In registration order, which is the order of `data.json` and of erasure.
   */
  all(): PrivacyContributor[] {
    return [...this.#contributors]
  }

  covered(): Set<string> {
    return new Set(this.#contributors.flatMap((contributor) => contributor.covers))
  }
}

export default new PrivacyRegistry()
