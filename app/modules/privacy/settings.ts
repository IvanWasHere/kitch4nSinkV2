import settings from '#settings/settings_service'

/**
 * The Privacy module's runtime settings (plan §22.3).
 */
declare module '#settings/settings_service' {
  interface SiteSettings {
    /**
     * How long a finished export can be downloaded before it is deleted.
     * Two days is long enough to notice the email, short enough that a copy
     * of somebody's whole account is not sitting in storage for long.
     */
    privacy_export_ttl_hours: number
  }
}

/**
 * Called once at boot from `start/settings.ts`.
 */
export function registerPrivacySettings() {
  settings.define('privacy_export_ttl_hours', 48)
}
