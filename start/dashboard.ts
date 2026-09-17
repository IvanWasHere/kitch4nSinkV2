/*
|--------------------------------------------------------------------------
| Dashboard widgets
|--------------------------------------------------------------------------
|
| What the Overview screen shows, in the order it shows it (plan §13.5).
|
| The dashboard has no subject of its own — it is whatever the application's
| features have to say about a workspace — so it holds no queries and names
| nothing. Each widget here supplies a loader and a partial, and
| `pages/dashboard/index.edge` iterates them.
|
| The usage meters are not widgets: they come from the quota registry
| (`start/quotas.ts`) and are part of the shell of the page rather than
| something a feature contributes.
|
| **Removing a feature means deleting its widgets here** — see
| `docs/modules.md`. The page renders whatever is left, and an empty
| registry renders an empty state rather than a broken screen.
|
*/

import dashboard from '#dashboard/widgets'
import todos from '#modules/lists/services/dashboard_service'

/**
 * The demo domain (D8) — delete with it.
 *
 * Three widgets rather than one, so that a replacement can keep the shape of
 * the screen while swapping what fills it: a row of figures, a table of what
 * is open, and a feed of what was finished.
 */
dashboard.register({
  key: 'todo_stats',
  region: 'stats',
  partial: 'pages/lists/widgets/stats',
  load: (organization) => todos.statsFor(organization),
})

dashboard.register({
  key: 'recent_todos',
  region: 'panels',
  partial: 'pages/lists/widgets/recent',
  load: (organization) => todos.recentTodos(organization),
})

dashboard.register({
  key: 'recent_activity',
  region: 'panels',
  partial: 'pages/lists/widgets/activity',
  load: (organization) => todos.recentActivity(organization),
})
