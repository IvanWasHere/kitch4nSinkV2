import { BaseTransformer } from '@adonisjs/core/transformers'

import type User from '#models/user'

/**
 * A member, for resolving `assigned_to` (plan §11).
 *
 * Deliberately thin. This endpoint exists so an integration can turn a name
 * into an id it may assign a todo to — it is not a directory export, so
 * nothing about the person beyond that is on the wire. No last sign-in, no
 * two-factor state, no avatar key.
 */
export default class MemberTransformer extends BaseTransformer<User> {
  toObject() {
    return {
      id: this.resource.publicId,
      name: this.resource.fullName,

      /**
       * Included because assigning work to the wrong "Sam" is the mistake
       * this endpoint exists to prevent, and an email is how a human
       * disambiguates two.
       */
      email: this.resource.email,
      role: this.resource.role,
    }
  }
}
