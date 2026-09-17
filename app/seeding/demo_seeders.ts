import type User from '#models/user'
import type Organization from '#models/organization'

/**
 * The demo dataset's contribution points (plan §12).
 *
 * `node ace dev:seed` builds the workspaces, the people in them, the
 * subscriptions, the announcements and the operations rows — everything a
 * screen needs to be legible rather than empty. What it does *not* do is
 * know what your product's rows look like.
 *
 * So a feature registers a seeder, gets handed the workspaces core made, and
 * fills them with its own data. Before this, the demo domain's lists and
 * todos were written into `commands/dev_seed.ts` itself, which made that
 * command the one piece of removal that had to be *rewritten* rather than
 * deleted (docs/modules.md).
 *
 * Every seeder this application has is registered in `start/seeders.ts`.
 */
export interface DemoWorkspace {
  organization: Organization
  owner: User

  /**
   * Everyone else who accepted an invitation, in the order they joined.
   */
  members: User[]
}

export interface DemoSeedContext {
  /**
   * Acme — the free tier, deliberately sitting at its caps so the at-cap
   * states can be looked at.
   */
  free: DemoWorkspace

  /**
   * Pro Widgets — the working week the demo is toured in.
   */
  pro: DemoWorkspace
}

export type DemoWorkspaceKey = keyof DemoSeedContext

export interface DemoSeeder {
  key: string

  /**
   * Staff-style limit overrides to merge onto a demo workspace before
   * seeding runs.
   *
   * A feature's meters are only worth showing if they are near their
   * ceiling, and a plan's real ceiling is usually too high to demonstrate
   * against — the demo domain drops `todosPerList` to 12 so a list can be
   * *seen* filling up. Merged over whatever core already set, never
   * replacing it.
   */
  overrides?: Partial<Record<DemoWorkspaceKey, Record<string, number | null>>>

  /**
   * Fill the workspaces with this feature's rows.
   *
   * Runs after core has created every workspace and person, so a seeder can
   * assign a row to a member and know they exist.
   */
  seed: (context: DemoSeedContext) => Promise<void>
}

export class DemoSeederRegistry {
  #seeders: DemoSeeder[] = []

  /**
   * Register a seeder. They run in registration order.
   */
  register(seeder: DemoSeeder): this {
    this.#seeders.push(seeder)
    return this
  }

  all(): DemoSeeder[] {
    return [...this.#seeders]
  }

  /**
   * The overrides every seeder wants on one workspace, merged into a single
   * object for the caller to apply.
   */
  overridesFor(workspace: DemoWorkspaceKey): Record<string, number | null> {
    return Object.assign({}, ...this.#seeders.map((seeder) => seeder.overrides?.[workspace] ?? {}))
  }

  reset(): this {
    this.#seeders = []
    return this
  }
}

export default new DemoSeederRegistry()
