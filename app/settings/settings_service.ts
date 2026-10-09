import type { HttpContext } from '@adonisjs/core/http'

import SiteSetting from '#models/site_setting'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'

/**
 * The type-level settings registry (plan §22.3, D11). A feature adds its keys
 * by augmentation, the way it adds API scopes:
 *
 * ```ts
 * declare module '#settings/settings_service' {
 *   interface SiteSettings {
 *     registration_enabled: boolean
 *   }
 * }
 * ```
 *
 * and gives each one a default with `settings.define(...)`. Core declares
 * none: every setting so far belongs to a feature, and goes when it does.
 */
export interface SiteSettings {}

export type SettingKey = keyof SiteSettings & string

/**
 * Settings an administrator changes at runtime, without a deploy.
 *
 * Deliberately **not cached**. The web server and the worker are separate
 * processes (plan §16), so a cached value would need invalidating across
 * them, and the reads so far are one primary-key lookup on a request that is
 * already doing far more. Revisit when a setting lands on a hot path.
 */
export class SettingsService {
  #defaults = new Map<SettingKey, unknown>()

  /**
   * Declare a key's default. Required before the key can be read: a typo in a
   * key is a compile error, and a key with no default is a startup bug that
   * should fail loudly on first read rather than read as `undefined`.
   */
  define<Key extends SettingKey>(key: Key, defaultValue: SiteSettings[Key]): this {
    this.#defaults.set(key, defaultValue)
    return this
  }

  /**
   * Every declared key, in declaration order — what a settings screen
   * iterates.
   */
  defined(): SettingKey[] {
    return [...this.#defaults.keys()]
  }

  async get<Key extends SettingKey>(key: Key): Promise<SiteSettings[Key]> {
    const fallback = this.defaultFor(key)
    const row = await SiteSetting.findBy('key', key)

    /**
     * A null value is "never set", not "set to null": the column is nullable
     * only because a JSON column has to be.
     */
    if (!row || row.value === null || row.value === undefined) {
      return fallback
    }

    return row.value as SiteSettings[Key]
  }

  /**
   * Change a setting. With a context, the change is a staff action and is
   * attributed to whoever is signed in to the back-office; without one it is
   * recorded as the system — a command or a test, never a tenant.
   *
   * Every change is audited with the value before and after, including a
   * change to the value it already had: "somebody saved the form" is still
   * something support may need to see.
   */
  async set<Key extends SettingKey>(
    key: Key,
    value: SiteSettings[Key],
    ctx?: HttpContext
  ): Promise<void> {
    const previous = await this.get(key)
    const staffId = ctx?.auth.use('staff').user?.id ?? null

    await SiteSetting.updateOrCreate({ key }, { value, updatedByStaffId: staffId })

    const entry = {
      action: AUDIT_ACTIONS.settingsChanged,
      subjectType: 'SiteSetting',
      subjectId: key,
      metadata: { key, from: previous, to: value },
    }

    if (ctx) {
      await audit.recordStaffAction(ctx, entry)
    } else {
      await audit.recordSystemAction(entry)
    }
  }

  private defaultFor<Key extends SettingKey>(key: Key): SiteSettings[Key] {
    if (!this.#defaults.has(key)) {
      throw new Error(`The setting "${key}" has no default — declare it with settings.define()`)
    }

    return this.#defaults.get(key) as SiteSettings[Key]
  }
}

export default new SettingsService()
