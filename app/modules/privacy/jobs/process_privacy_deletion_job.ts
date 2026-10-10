import type { JobContext, JobHandler } from '#queue/contracts'
import deletion from '#modules/privacy/services/deletion_service'

/**
 * Deletes one account an admin approved (plan §22.8.2). Dispatched by the
 * approval; never scheduled. Retried by the queue, and safe to retry — see
 * `DeletionService.process`.
 */
class ProcessPrivacyDeletionJob implements JobHandler<{ requestId: number }> {
  readonly name = 'process_privacy_deletion'

  async handle(payload: { requestId: number }, context: JobContext) {
    await deletion.process(payload.requestId, context.isFinalAttempt)
  }
}

export default new ProcessPrivacyDeletionJob()
