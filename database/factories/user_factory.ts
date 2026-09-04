import { DateTime } from 'luxon'
import factory from '@adonisjs/lucid/factories'

import User from '#models/user'
import { generatePublicId } from '#models/public_id'
import { OrganizationFactory } from '#database/factories/organization_factory'

/**
 * A verified member by default, because that is the state most tests want to
 * start from. `unverified`, `owner` and `withTwoFactor` opt out of it.
 */
export const UserFactory = factory
  .define(User, async ({ faker }) => ({
    publicId: generatePublicId('user'),
    email: faker.internet.email().toLowerCase(),
    password: 'secret-password-12',
    fullName: faker.person.fullName(),
    role: 'member' as const,
  }))
  .state('owner', (user) => {
    user.role = 'owner'
  })
  .state('verified', (user) => {
    user.emailVerifiedAt = DateTime.utc()
  })
  .relation('organization', () => OrganizationFactory)
  .build()
