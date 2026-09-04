import type { JobHandler } from '#queue/contracts'

import sendMailJob from '#queue/jobs/send_mail_job'
import expireInvitationsJob from '#queue/jobs/expire_invitations_job'

/**
 * Every handler the worker knows how to run, keyed by the name stored in
 * `jobs.name`.
 *
 * An explicit map rather than directory scanning: a job whose handler has
 * silently disappeared should be a loud "unknown job" failure the admin panel
 * shows, not a job that is quietly never picked up.
 *
 * Milestones add to this — ProcessWebhookJob and SyncBillingJob in M4,
 * PurgeDeletedFilesJob in M5, RollupApiUsageJob in M6, PruneAuditLogsJob in
 * M7 (plan §9).
 */
export const jobHandlers: Record<string, JobHandler<any>> = {
  [sendMailJob.name]: sendMailJob,
  [expireInvitationsJob.name]: expireInvitationsJob,
}

export function handlerFor(name: string): JobHandler<any> | null {
  return jobHandlers[name] ?? null
}
