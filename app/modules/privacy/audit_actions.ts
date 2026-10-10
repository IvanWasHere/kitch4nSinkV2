/**
 * The Privacy module's audit actions (plan §22.4, D12) — added by
 * augmentation, so they leave with the module.
 */
declare module '#audit/audit_service' {
  interface AuditActions {
    'privacy.export.requested': true
    'privacy.export.generated': true
    'privacy.export.failed': true
    'privacy.export.downloaded': true
    'privacy.export.viewed': true
    'privacy.export.purged': true
    'privacy.export.retried': true
    'privacy.deletion.requested': true
    'privacy.deletion.started_by_staff': true
    'privacy.export.started_by_staff': true
    'privacy.deletion.confirmed': true
    'privacy.deletion.cancelled': true
    'privacy.deletion.approved': true
    'privacy.deletion.rejected': true
    'privacy.deletion.retried': true
    'privacy.deletion.completed': true
    'privacy.deletion.failed': true
  }
}

export {}
