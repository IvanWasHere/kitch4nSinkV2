import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

import User from '#models/user'
import { SocialAccountSchema } from '#database/schema'

/**
 * A Google or GitHub identity linked to a user.
 *
 * The unique index on (provider, provider_user_id) is what makes repeat
 * sign-ins idempotent, and what stops two accounts being created for the same
 * person if they click the button twice.
 */
export default class SocialAccount extends SocialAccountSchema {
  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}
