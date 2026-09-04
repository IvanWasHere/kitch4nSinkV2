import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'

import User from '#models/user'
import SocialAccount from '#models/social_account'
import registration from '#auth/registration_service'
import { startTwoFactorChallenge } from '#auth/two_factor_challenge'
import { socialProviders, type SocialProviderName } from '#config/ally'

/**
 * Google and GitHub sign-in, with account linking.
 *
 * Three cases have to be told apart, and getting them wrong is how people end
 * up with duplicate accounts or, worse, someone else's:
 *
 *   1. The provider identity is already linked → sign that user in.
 *   2. The provider's *verified* email matches an existing user → link it.
 *   3. Neither → register a new organisation and owner.
 *
 * Case 2 is only safe because the provider asserts the address is verified.
 * An unverified provider email would let anyone who can register an account
 * at the provider claim a matching account here.
 */
export default class SocialAuthController {
  async redirect({ ally, params, response, session }: HttpContext) {
    const provider = this.provider(params.provider)

    if (!provider) {
      session.flash('error', 'That sign-in method is not available.')
      return response.redirect().toRoute('auth.session.create')
    }

    return ally.use(provider).redirect()
  }

  async callback({ ally, params, auth, response, session }: HttpContext) {
    const provider = this.provider(params.provider)

    if (!provider) {
      return response.redirect().toRoute('auth.session.create')
    }

    const driver = ally.use(provider)

    if (driver.accessDenied()) {
      session.flash('error', 'You cancelled the sign-in.')
      return response.redirect().toRoute('auth.session.create')
    }

    if (driver.stateMisMatch()) {
      session.flash('error', 'That sign-in request expired. Please try again.')
      return response.redirect().toRoute('auth.session.create')
    }

    if (driver.hasError()) {
      session.flash('error', driver.getError() || 'Sign-in failed. Please try again.')
      return response.redirect().toRoute('auth.session.create')
    }

    const profile = await driver.user()
    const email = profile.email?.trim().toLowerCase() ?? null

    const existingLink = await SocialAccount.query()
      .where('provider', provider)
      .where('provider_user_id', String(profile.id))
      .preload('user')
      .first()

    let user: User

    if (existingLink) {
      user = existingLink.user
      existingLink.accessToken = profile.token.token
      existingLink.providerEmail = email
      await existingLink.save()
    } else {
      if (!email) {
        session.flash('error', `Your ${provider} account has no email address we can use.`)
        return response.redirect().toRoute('auth.session.create')
      }

      /**
       * Only link to an existing account when the provider says the address
       * is verified — otherwise this is an account-takeover path.
       */
      const existingUser =
        profile.emailVerificationState === 'verified'
          ? await User.query().where('email', email).whereNull('deleted_at').first()
          : null

      if (existingUser) {
        user = existingUser
        await SocialAccount.create({
          userId: user.id,
          provider,
          providerUserId: String(profile.id),
          providerEmail: email,
          accessToken: profile.token.token,
        })
      } else {
        const registered = await db.transaction(async (trx) => {
          const created = await registration.register(
            { fullName: profile.name ?? null, email, password: null },
            trx
          )

          await SocialAccount.create(
            {
              userId: created.user.id,
              provider,
              providerUserId: String(profile.id),
              providerEmail: email,
              accessToken: profile.token.token,
            },
            { client: trx }
          )

          return created
        })

        user = registered.user
      }

      /**
       * The provider has already proved the address, so there is nothing for
       * our own verification email to add.
       */
      if (profile.emailVerificationState === 'verified' && !user.hasVerifiedEmail) {
        user.emailVerifiedAt = DateTime.utc()
        await user.save()
      }
    }

    if (user.hasTwoFactor) {
      startTwoFactorChallenge(session, 'web', user.id)
      return response.redirect().toRoute('auth.two_factor.create')
    }

    await auth.use('web').login(user)
    await user.recordLogin()

    return response.redirect().toRoute('dashboard.index')
  }

  private provider(value: string): SocialProviderName | null {
    const match = socialProviders.find(
      (candidate) => candidate.name === value && candidate.configured
    )
    return match ? match.name : null
  }
}
