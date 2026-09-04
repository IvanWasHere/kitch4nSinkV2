import { BaseMail } from '@adonisjs/mail'
import router from '@adonisjs/core/services/router'
import env from '#start/env'

import type Todo from '#models/todo'
import type User from '#models/user'
import type Organization from '#models/organization'

/**
 * One email a day per person, listing what of theirs is overdue.
 *
 * Per person rather than per todo: five overdue items should be one message,
 * not five.
 */
export default class OverdueDigestNotification extends BaseMail {
  constructor(
    private user: User,
    private organization: Organization,
    private todos: Todo[]
  ) {
    super()
  }

  prepare() {
    const url = `${env.get('APP_URL')}${router.makeUrl('lists.index')}`
    const count = this.todos.length

    this.message
      .to(this.user.email)
      .subject(`${count} overdue ${count === 1 ? 'todo' : 'todos'} in ${this.organization.name}`)
      .htmlView('emails/overdue_digest', {
        user: this.user,
        organization: this.organization,
        todos: this.todos,
        url,
      })
      .textView('emails/overdue_digest_text', {
        user: this.user,
        organization: this.organization,
        todos: this.todos,
        url,
      })
  }
}
