import { SiteSettingSchema } from '#database/schema'

/**
 * One runtime setting's stored value (plan §22.3).
 *
 * Read and written through `SettingsService` only — it is what knows each
 * key's type and default, and what writes the audit entry. Querying this
 * model directly gets an untyped `unknown` and skips both.
 */
export default class SiteSetting extends SiteSettingSchema {}
