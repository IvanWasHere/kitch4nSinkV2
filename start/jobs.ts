/*
|--------------------------------------------------------------------------
| Background jobs
|--------------------------------------------------------------------------
|
| Every job the worker knows how to run, and which cron tick dispatches the
| recurring ones (plan §9).
|
| `app/queue/registry.ts` owns the lookup and the schedule filter; it does not
| know what jobs exist. Registering here means `node ace queue:work` and
| `node ace schedule:run` both read one list, and a feature's jobs leave with
| the feature (docs/modules.md).
|
| A job with no schedule is dispatched by application code rather than by
| cron — `send_mail` when something is sent, `process_webhook` when one
| arrives.
|
| Renaming a `handler.name` strands the rows already queued under the old
| name, so treat those as permanent even while moving registrations around.
|
| **Removing a feature means deleting its block here.**
|
*/

import jobs from '#queue/registry'

import sendMailJob from '#queue/jobs/send_mail_job'
import expireInvitationsJob from '#queue/jobs/expire_invitations_job'
import processWebhookJob from '#queue/jobs/process_webhook_job'
import syncBillingJob from '#queue/jobs/sync_billing_job'
import purgeDeletedFilesJob from '#queue/jobs/purge_deleted_files_job'
import rollupApiUsageJob from '#queue/jobs/rollup_api_usage_job'
import pruneAuditLogsJob from '#queue/jobs/prune_audit_logs_job'
import pruneNotificationsJob from '#queue/jobs/prune_notifications_job'

import overdueDigestJob from '#modules/lists/jobs/overdue_digest_job'
import reconcileCountersJob from '#modules/lists/jobs/reconcile_counters_job'
import normalizePositionsJob from '#modules/lists/jobs/normalize_positions_job'

/**
 * Dispatched by application code, not by cron.
 */
jobs.register(sendMailJob)
jobs.register(processWebhookJob)

/**
 * Core recurring work.
 */
jobs.register(expireInvitationsJob, { interval: 'daily', label: 'expire invitations' })
jobs.register(syncBillingJob, { interval: 'daily', label: 'reconcile billing' })
jobs.register(purgeDeletedFilesJob, { interval: 'daily', label: 'purge deleted files' })
jobs.register(rollupApiUsageJob, { interval: 'daily', label: 'roll up API usage' })
jobs.register(pruneAuditLogsJob, { interval: 'daily', label: 'prune audit logs' })
jobs.register(pruneNotificationsJob, {
  interval: 'daily',
  label: 'prune deleted announcements',
})

/**
 * The demo domain (D8) — delete with it.
 *
 * `normalize_positions` is also dispatched directly, with a `listId`, after a
 * reorder that ran the gaps down; the daily sweep is the catch-all.
 */
jobs.register(overdueDigestJob, { interval: 'daily', label: 'overdue digests' })
jobs.register(reconcileCountersJob, { interval: 'daily', label: 'reconcile todo counters' })
jobs.register(normalizePositionsJob, { interval: 'daily', label: 'normalize list positions' })
