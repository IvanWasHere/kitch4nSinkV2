import factory from '@adonisjs/lucid/factories'

import Organization from '#models/organization'
import { generatePublicId } from '#models/public_id'

export const OrganizationFactory = factory
  .define(Organization, async ({ faker }) => {
    const name = faker.company.name()

    return {
      publicId: generatePublicId('organization'),
      name,
      slug: `${faker.helpers.slugify(name).toLowerCase()}-${faker.string.alphanumeric(6).toLowerCase()}`,
      planKey: 'free',
      status: 'active' as const,
    }
  })
  .build()
