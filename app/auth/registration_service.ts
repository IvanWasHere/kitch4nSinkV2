import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import User from '#models/user'
import Organization from '#models/organization'
import { generateOrganizationSlug } from '#auth/slug'

export interface RegistrationInput {
  fullName: string | null
  email: string
  password?: string | null
  organizationName?: string | null
}

/**
 * Registration creates an organisation and its owner together.
 *
 * This is the one place in the application where a user exists without an
 * organisation, and it must never be observable: the two inserts run in a
 * single transaction, so a failure part-way leaves nothing behind rather than
 * an orphaned user with no tenant to belong to.
 */
export class RegistrationService {
  /**
   * @param client an open transaction to join. Social signup creates the
   *   organisation, the owner *and* the provider link as one unit, so it
   *   supplies its own rather than letting this method open a second one.
   */
  async register(
    input: RegistrationInput,
    client?: TransactionClientContract
  ): Promise<{ user: User; organization: Organization }> {
    const email = input.email.trim().toLowerCase()
    const organizationName = (
      input.organizationName || this.defaultOrganizationName(input, email)
    ).trim()

    const run = async (trx: TransactionClientContract) => {
      const slug = await generateOrganizationSlug(organizationName, trx)

      const organization = await Organization.create(
        { name: organizationName, slug, planKey: 'free', status: 'active' },
        { client: trx }
      )

      const user = await User.create(
        {
          organizationId: organization.id,
          role: 'owner',
          email,
          password: input.password ?? null,
          fullName: input.fullName,
        },
        { client: trx }
      )

      /**
       * `owner_id` is set after the user exists because the two tables
       * reference each other (plan §5.3). Inside the transaction the
       * intermediate state is never visible to anyone else.
       */
      organization.useTransaction(trx)
      organization.ownerId = user.id
      await organization.save()

      return { user, organization }
    }

    return client ? run(client) : db.transaction(run)
  }

  /**
   * Someone signing up through Google is not asked to name a workspace, so
   * one is derived from their own name — "Jane Cooper's workspace" — which
   * they can rename later in organisation settings.
   */
  private defaultOrganizationName(input: RegistrationInput, email: string): string {
    const name = input.fullName?.trim()

    if (name) {
      return `${name}'s workspace`
    }

    return `${email.split('@')[0]}'s workspace`
  }
}

export default new RegistrationService()
