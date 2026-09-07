import { ApiUsageDaySchema } from '#database/schema'

/**
 * A day of API usage, rolled up (plan §5.2).
 *
 * Survives the pruning of `api_requests`, so a customer's usage history does
 * not quietly end 30 days ago.
 */
export default class ApiUsageDay extends ApiUsageDaySchema {}
