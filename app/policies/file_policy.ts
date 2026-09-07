import { BasePolicy } from '@adonisjs/bouncer'
import { type AuthorizerResponse } from '@adonisjs/bouncer/types'

import type File from '#models/file'
import type User from '#models/user'
import type Organization from '#models/organization'

/**
 * Files belong to the organisation, the same rule lists follow (D8). `userId`
 * is provenance for the UI and appears in exactly one check below — deletion
 * — and never in a read.
 */
export default class FilePolicy extends BasePolicy {
  private inOrganization(user: User, file: File): boolean {
    return user.organizationId === file.organizationId
  }

  viewAny(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id
  }

  view(user: User, file: File): AuthorizerResponse {
    return this.inOrganization(user, file)
  }

  /**
   * Any member may upload (plan §6). What they may upload, and how much, is
   * the quota's business, not the policy's.
   */
  create(user: User, organization: Organization): AuthorizerResponse {
    return user.organizationId === organization.id
  }

  /**
   * Deleting is available to whoever uploaded it, and to the owner.
   *
   * Softer than list deletion, which is owner-only, because the shapes differ:
   * deleting a list destroys shared work built by several people, while a file
   * has exactly one author, the delete is reversible for 30 days, and forcing
   * a member to ask the owner to remove a file they just uploaded by mistake
   * is friction with nothing behind it.
   */
  delete(user: User, file: File): AuthorizerResponse {
    return this.inOrganization(user, file) && (user.isOwner || file.userId === user.id)
  }
}
