import { ApiRequestSchema } from '#database/schema'

/**
 * One API request, for usage and for support (plan §5.2).
 *
 * Write-mostly: nothing in a request path reads this table. It is aggregated
 * nightly by `RollupApiUsageJob` and pruned after 30 days, so it stays a log
 * rather than becoming the largest table in the database.
 */
export default class ApiRequest extends ApiRequestSchema {
  get isError() {
    return this.status >= 400
  }
}
