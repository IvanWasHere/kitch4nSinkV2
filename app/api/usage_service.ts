import { DateTime } from 'luxon'

import ApiRequest from '#models/api_request'
import ApiUsageDay from '#models/api_usage_day'
import type Organization from '#models/organization'

export interface UsageDay {
  day: string
  requests: number
  errors: number
}

/**
 * What the API usage screen reads (plan §13.5).
 *
 * Two sources, because the rollup runs nightly: `api_usage_days` for
 * finished days, and the raw `api_requests` for today. Reading only the
 * rollup would show a customer zero calls until tomorrow, which reliably
 * reads as "the API is broken".
 */
export class ApiUsageService {
  /**
   * Calls so far this calendar month — the figure the monthly quota is
   * spent against.
   *
   * Counted from the raw table, which is retained for 30 days and therefore
   * always covers the current month. The limiter holds the authoritative
   * counter; this is the human-readable view of the same traffic.
   */
  async monthToDate(organization: Organization): Promise<number> {
    const requests = await ApiRequest.query().where('organization_id', organization.id)
    const month = DateTime.utc().toFormat('yyyy-MM')

    /**
     * Filtered from the model's own timestamp rather than in SQL: comparing a
     * timestamp column against a bound value means different things on the
     * two engines (CONTRIBUTING).
     */
    return requests.filter((request) => request.createdAt.toUTC().toFormat('yyyy-MM') === month)
      .length
  }

  /**
   * The last `days` days, oldest first, with zero-filled gaps.
   *
   * Gaps are filled because a chart that silently omits quiet days makes a
   * weekend look like an outage.
   */
  async recentDays(organization: Organization, days = 14): Promise<UsageDay[]> {
    const [rolled, raw] = await Promise.all([
      ApiUsageDay.query().where('organization_id', organization.id),
      ApiRequest.query().where('organization_id', organization.id),
    ])

    const totals = new Map<string, UsageDay>()

    for (const row of rolled) {
      totals.set(row.day, { day: row.day, requests: row.requests, errors: row.errors })
    }

    /**
     * Raw rows win over the rollup for any day they cover: today has no
     * rollup yet, and a day that has both is one the rollup recomputed from
     * exactly these rows.
     */
    const fromRaw = new Map<string, UsageDay>()

    for (const request of raw) {
      const day = request.createdAt.toUTC().toFormat('yyyy-MM-dd')
      const entry = fromRaw.get(day) ?? { day, requests: 0, errors: 0 }

      entry.requests++

      if (request.isError) {
        entry.errors++
      }

      fromRaw.set(day, entry)
    }

    for (const [day, entry] of fromRaw) {
      totals.set(day, entry)
    }

    const today = DateTime.utc().startOf('day')

    return Array.from({ length: days }, (_, index) => {
      const day = today.minus({ days: days - 1 - index }).toFormat('yyyy-MM-dd')

      return totals.get(day) ?? { day, requests: 0, errors: 0 }
    })
  }
}

export default new ApiUsageService()
