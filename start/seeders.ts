/*
|--------------------------------------------------------------------------
| Demo seeders
|--------------------------------------------------------------------------
|
| What each feature puts into the demo workspaces `node ace dev:seed` builds
| (plan §12).
|
| The command owns the workspaces, the people, the subscriptions, the
| announcements and the operations rows. It does not know what your product's
| rows look like — so a feature registers a seeder, is handed the workspaces,
| and fills them itself.
|
| Seeders run in registration order, after every workspace and person exists.
|
| **Removing a feature means deleting its line here** — see
| `docs/modules.md`. Without it, `dev:seed` still builds a complete demo of
| everything core has.
|
*/

import seeders from '#seeding/demo_seeders'
import { listsDemoSeeder } from '#modules/lists/seeder'
import { contentDemoSeeder } from '#modules/content/seeder'
import { registrationControlDemoSeeder } from '#modules/registration_control/seeder'
import { privacyDemoSeeder } from '#modules/privacy/seeder'

/**
 * The demo domain (D8) — delete with it.
 */
seeders.register(listsDemoSeeder)

/**
 * Content (plan §22.6): posts in every state, and two pages.
 */
seeders.register(contentDemoSeeder)

/**
 * Registration Control (plan §22.5): a waiting list with somebody in every
 * state.
 */
seeders.register(registrationControlDemoSeeder)

/**
 * Privacy (plan §22.8): an export or deletion request in each state the
 * back office filters by. Last, so the export it builds holds what the
 * seeders above wrote.
 */
seeders.register(privacyDemoSeeder)
