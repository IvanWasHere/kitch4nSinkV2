import settings from '#settings/settings_service'
import registrationGate from '#auth/registration_gate'

/**
 * Registration Control's runtime settings (plan §22.3, §22.5).
 *
 * Both default to the PRD's recommendation (plan §19 Q7d): registration open,
 * so installing the module changes nothing until somebody flips the switch,
 * and double opt-in on, so the waiting list never fills with addresses
 * nobody confirmed.
 */
declare module '#settings/settings_service' {
  interface SiteSettings {
    registration_enabled: boolean
    waiting_list_double_opt_in: boolean
  }
}

/**
 * Called once at boot from `start/settings.ts`.
 *
 * Also hands the registration gate its answer (plan §22.2, D10). Core asks the
 * gate; this module is the only thing that ever tells it "closed". Delete the
 * call and the gate is back to its default — open.
 */
export function registerRegistrationSettings() {
  settings.define('registration_enabled', true).define('waiting_list_double_opt_in', true)

  registrationGate.decideWith(() => settings.get('registration_enabled'))
}
