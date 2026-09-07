import { AuditLogSchema } from '#database/schema'

/**
 * One entry in the audit trail (plan §5.2, §12).
 *
 * Append-only. Nothing in the application updates a row here, and the only
 * thing that deletes one is `PruneAuditLogsJob` at the end of the retention
 * window — a trail that can be edited is not a trail.
 */
export default class AuditLog extends AuditLogSchema {
  get isStaffAction() {
    return this.actorType === 'staff'
  }

  /**
   * Whether this happened while a staff member was impersonating a customer.
   *
   * The pair of ids is the whole point of the impersonation rule (plan §6):
   * the action was taken *as* the user, *by* a staff member, and both have to
   * survive in the record.
   */
  get isImpersonated() {
    return Boolean(this.metadata?.impersonatorStaffId)
  }
}
