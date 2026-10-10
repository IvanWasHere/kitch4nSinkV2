/*
|--------------------------------------------------------------------------
| Privacy registry
|--------------------------------------------------------------------------
|
| Everything this application stores about a person, by feature (plan §22.8).
| A data export collects every section registered here, and a deletion will
| erase or anonymise through the same list — so a feature that keeps
| personal data and is not registered here is a feature whose data is left
| out of both. `tests/unit/privacy_coverage.spec.ts` checks that every column
| pointing at a user is accounted for by somebody.
|
| Registration order is the order of sections in `data.json`.
|
| **Removing a feature means deleting its line here** — see
| `docs/modules.md`.
|
*/

import privacy from '#privacy/registry'
import { coreContributors } from '#privacy/core_contributors'
import { listsPrivacyContributor } from '#modules/lists/privacy'
import { waitingListPrivacyContributor } from '#modules/registration_control/privacy'
import { privacyRequestsContributor } from '#modules/privacy/privacy'

for (const contributor of coreContributors) {
  privacy.register(contributor)
}

/**
 * The demo domain (D8) — delete with it.
 */
privacy.register(listsPrivacyContributor)

/**
 * Registration Control (plan §22.5) — delete with it.
 */
privacy.register(waitingListPrivacyContributor)

/**
 * Privacy (plan §22.8) — the person's own export and deletion requests.
 */
privacy.register(privacyRequestsContributor)
