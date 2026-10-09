/**
 * Registration Control's audit actions (plan §22.4, D12) — added by
 * augmentation, so they leave with the module.
 *
 * Staff actions only. Joining and confirming are anonymous public events and
 * are logged rather than audited; they would bury the audit screen.
 */
declare module '#audit/audit_service' {
  interface AuditActions {
    'waitlist.cancelled': true
    'waitlist.converted': true
    'waitlist.resent': true
    'waitlist.deleted': true
  }
}

export {}
