import type { JobHandler } from '#queue/contracts'

import sendMailJob from '#queue/jobs/send_mail_job'
import expireInvitationsJob from '#queue/jobs/expire_invitations_job'
import overdueDigestJob from '#queue/jobs/overdue_digest_job'
import reconcileCountersJob from '#queue/jobs/reconcile_counters_job'
import normalizePositionsJob from '#queue/jobs/normalize_positions_job'
import processWebhookJob from '#queue/jobs/process_webhook_job'
import syncBillingJob from '#queue/jobs/sync_billing_job'
import purgeDeletedFilesJob from '#queue/jobs/purge_deleted_files_job'
import rollupApiUsageJob from '#queue/jobs/rollup_api_usage_job'
import pruneAuditLogsJob from '#queue/jobs/prune_audit_logs_job'

/**
 * Every handler the worker knows how to run, keyed by the name stored in
 * `jobs.name`.
 *
 * An explicit map rather than directory scanning: a job whose handler has
 * silently disappeared should be a loud "unknown job" failure the admin panel
 * shows, not a job that is quietly never picked up.
 *
 * Every recurring job the application has is here; `schedule:run` is what
 * dispatches them.
 */
export const jobHandlers: Record<string, JobHandler<any>> = {
  [sendMailJob.name]: sendMailJob,
  [expireInvitationsJob.name]: expireInvitationsJob,
  [overdueDigestJob.name]: overdueDigestJob,
  [reconcileCountersJob.name]: reconcileCountersJob,
  [normalizePositionsJob.name]: normalizePositionsJob,
  [processWebhookJob.name]: processWebhookJob,
  [syncBillingJob.name]: syncBillingJob,
  [purgeDeletedFilesJob.name]: purgeDeletedFilesJob,
  [rollupApiUsageJob.name]: rollupApiUsageJob,
  [pruneAuditLogsJob.name]: pruneAuditLogsJob,
}

export function handlerFor(name: string): JobHandler<any> | null {
  return jobHandlers[name] ?? null
}
