import type { JobContext, JobHandler } from '#queue/contracts'
import privacy from '#modules/privacy/services/privacy_service'

/**
 * Builds one data export (plan §22.8.1). Dispatched when somebody asks for
 * one; never scheduled. Retried by the queue on failure, and idempotent —
 * see `PrivacyService.generate`.
 */
class GeneratePrivacyExportJob implements JobHandler<{ requestId: number }> {
  readonly name = 'generate_privacy_export'

  async handle(payload: { requestId: number }, context: JobContext) {
    await privacy.generate(payload.requestId, context.isFinalAttempt)
  }
}

export default new GeneratePrivacyExportJob()
