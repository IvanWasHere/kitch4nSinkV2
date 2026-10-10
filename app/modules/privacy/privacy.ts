import type User from '#models/user'
import type { PrivacyContributor } from '#privacy/registry'
import PrivacyRequest from '#modules/privacy/models/privacy_request'

/**
 * The Privacy module's own share of a person's data: the requests they have
 * made. Kept after a deletion completes (plan §22.8.4) — it is the record
 * that the request was honoured.
 */
export const privacyRequestsContributor: PrivacyContributor = {
  key: 'privacyRequests',
  describes: 'The data exports and deletion requests you have made, and what happened to each.',
  covers: ['privacy_requests.user_id'],

  async export(user: User) {
    const requests = await PrivacyRequest.query().where('user_id', user.id).orderBy('id')

    return requests.map((request) => ({
      id: request.publicId,
      type: request.type,
      status: request.status,
      requestedAt: request.requestedAt.toISO(),
      completedAt: request.completedAt?.toISO() ?? null,
    }))
  },
}
