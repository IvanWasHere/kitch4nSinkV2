import factory from '@adonisjs/lucid/factories'

import StaffUser from '#models/staff_user'
import { generatePublicId } from '#models/public_id'

export const StaffUserFactory = factory
  .define(StaffUser, async ({ faker }) => ({
    publicId: generatePublicId('staffUser'),
    email: faker.internet.email().toLowerCase(),
    password: 'secret-password-12',
    fullName: faker.person.fullName(),
    role: 'support' as const,
  }))
  .state('admin', (staff) => {
    staff.role = 'admin'
  })
  .build()
