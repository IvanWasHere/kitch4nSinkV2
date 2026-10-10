import logger from '@adonisjs/core/services/logger'

import type { JobHandler } from '#queue/contracts'
import privacy from '#modules/privacy/services/privacy_service'

/**
 * Deletes data exports past their download window (plan §22.8.1). Hourly,
 * so an archive never outlives its expiry by much more than that.
 */
class PurgePrivacyExportsJob implements JobHandler {
  readonly name = 'purge_privacy_exports'

  async handle() {
    const purged = await privacy.purgeExpired()

    if (purged > 0) {
      logger.info({ purged }, 'purged expired privacy exports')
    }
  }
}

export default new PurgePrivacyExportsJob()
