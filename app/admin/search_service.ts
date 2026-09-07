import User from '#models/user'
import Organization from '#models/organization'

/**
 * Finding a customer from whatever the ticket gave you (plan §12).
 *
 * A support agent has an email, half a workspace name, or a `public_id` a
 * customer pasted from a URL — so one box takes all three rather than three
 * boxes that each work for one.
 */
export class AdminSearchService {
  /**
   * Case-insensitivity is done by lowercasing both sides rather than with
   * `ILIKE` or `citext`, which portability rule 5 rules out. Emails are
   * already stored lowercased; names are not, so those are filtered in
   * memory over a bounded result set.
   */
  async organizations(term: string, limit = 25): Promise<Organization[]> {
    const needle = term.trim().toLowerCase()

    if (!needle) {
      return Organization.query().whereNull('deleted_at').orderBy('id', 'desc').limit(limit)
    }

    /**
     * An exact `public_id` short-circuits: it is the one identifier that is
     * unambiguous, and it is what a customer pastes out of a URL.
     */
    if (needle.startsWith('org_')) {
      const exact = await Organization.query().where('public_id', needle).first()

      if (exact) {
        return [exact]
      }
    }

    /**
     * An email finds the workspace through its member, which is how a
     * support ticket usually identifies one.
     */
    const byEmail = await User.query()
      .where('email', needle)
      .whereNull('deleted_at')
      .select('organization_id')

    const candidates = await Organization.query()
      .whereNull('deleted_at')
      .orderBy('id', 'desc')
      .limit(500)

    const matched = candidates.filter(
      (organization) =>
        organization.name.toLowerCase().includes(needle) ||
        organization.slug.includes(needle) ||
        organization.publicId === needle ||
        byEmail.some((user) => user.organizationId === organization.id)
    )

    return matched.slice(0, limit)
  }

  async users(term: string, limit = 25): Promise<User[]> {
    const needle = term.trim().toLowerCase()

    const query = User.query().preload('organization').orderBy('id', 'desc')

    if (!needle) {
      return query.limit(limit)
    }

    if (needle.startsWith('usr_')) {
      const exact = await User.query().where('public_id', needle).preload('organization').first()

      if (exact) {
        return [exact]
      }
    }

    /**
     * Soft-deleted users are included on purpose: "we removed them and now
     * they cannot get back in" is a support question about somebody who is
     * deleted.
     */
    const candidates = await query.limit(500)

    return candidates
      .filter(
        (user) =>
          user.email.includes(needle) ||
          (user.fullName ?? '').toLowerCase().includes(needle) ||
          user.publicId === needle
      )
      .slice(0, limit)
  }
}

export default new AdminSearchService()
