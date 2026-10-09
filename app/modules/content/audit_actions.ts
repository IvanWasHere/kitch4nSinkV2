/**
 * The Content module's audit actions (plan §22.4, D12) — added by
 * augmentation, so they leave with the module.
 */
declare module '#audit/audit_service' {
  interface AuditActions {
    'content.created': true
    'content.updated': true
    'content.published': true
    'content.unpublished': true
    'content.archived': true
    'content.deleted': true
  }
}

export {}
