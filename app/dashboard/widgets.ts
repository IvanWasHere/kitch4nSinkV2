import type Organization from '#models/organization'

/**
 * The Overview screen's widget registry (plan §13.5).
 *
 * The dashboard is the one screen with no subject of its own: it is whatever
 * the application's features have to say about a workspace. So it holds no
 * queries and no knowledge of what it is showing — each feature registers a
 * widget, and the page iterates them.
 *
 * Before this, `DashboardController` imported the demo domain's service
 * directly and the template read `stats.openTodos`, which made the
 * application's home page unrenderable the moment that domain was removed.
 *
 * Registration happens in `start/dashboard.ts`, for the same reason
 * `app/queue/registry.ts` is an explicit map: a widget that silently stopped
 * being registered would be a panel that silently disappeared, and the
 * dashboard is the screen nobody would think to check.
 */
export type DashboardRegion = 'stats' | 'panels'

export interface DashboardWidget {
  /**
   * Stable identifier, used as the loop key and in the empty-state message.
   */
  key: string

  /**
   * `stats` is the row of figures across the top; `panels` is the grid
   * beneath the usage meters.
   */
  region: DashboardRegion

  /**
   * The Edge template to render, relative to `resources/views`. It receives
   * the enclosing scope plus `widget`, so it reads its own data as
   * `widget.data`.
   */
  partial: string

  /**
   * Whatever the partial needs, loaded once per request.
   *
   * Every widget's `load` runs in parallel, but they all run on a screen the
   * customer waits for — so this is the wrong place for a query that is not
   * bounded and indexed.
   */
  load?: (organization: Organization) => Promise<unknown> | unknown
}

export interface LoadedWidget {
  key: string
  partial: string
  data: unknown
}

export type DashboardData = Record<DashboardRegion, LoadedWidget[]>

export class DashboardRegistry {
  #widgets: DashboardWidget[] = []

  /**
   * Register a widget. Insertion order is render order within a region.
   */
  register(widget: DashboardWidget): this {
    this.#widgets.push(widget)
    return this
  }

  all(): DashboardWidget[] {
    return [...this.#widgets]
  }

  /**
   * Drop every registration.
   *
   * For an application that wants the screen entirely to itself rather than
   * the demo domain's version of it, and for the test that renders the
   * dashboard with nothing registered — the case that has to keep working,
   * because a home page that 500s when a feature is removed is the failure
   * this registry exists to prevent.
   */
  reset(): this {
    this.#widgets = []
    return this
  }

  /**
   * Load every widget's data, in parallel, grouped by region.
   *
   * One `Promise.all` across all of them rather than one per region: the
   * regions are a layout concern and there is no reason the panels should
   * wait for the stats.
   */
  async load(organization: Organization): Promise<DashboardData> {
    const loaded = await Promise.all(
      this.#widgets.map(async (widget): Promise<LoadedWidget & { region: DashboardRegion }> => {
        return {
          key: widget.key,
          region: widget.region,
          partial: widget.partial,
          data: widget.load ? await widget.load(organization) : null,
        }
      })
    )

    return {
      stats: loaded.filter((widget) => widget.region === 'stats'),
      panels: loaded.filter((widget) => widget.region === 'panels'),
    }
  }
}

export default new DashboardRegistry()
