/*
|--------------------------------------------------------------------------
| Settings registry
|--------------------------------------------------------------------------
|
| Every runtime setting this application has, given its default (plan
| §22.3). A key is *typed* by the feature that declares it; this file is
| where it is *defined*, so the defaults exist before the first request reads
| one.
|
| An explicit file for the reason `start/quotas.ts` is one: a setting that
| silently stopped being registered would read as an error on the first page
| that asked for it.
|
| **Removing a feature means deleting its line here** — see
| `docs/modules.md`.
|
*/

import { registerRegistrationSettings } from '#modules/registration_control/settings'
import { registerPrivacySettings } from '#modules/privacy/settings'

/**
 * Registration Control (plan §22.5): whether public signup is open, and
 * whether the waiting list asks for confirmation. Also closes the
 * registration gate when told to — without this line, signup is open.
 */
registerRegistrationSettings()

/**
 * Privacy (plan §22.8): how long a finished data export stays downloadable.
 */
registerPrivacySettings()
