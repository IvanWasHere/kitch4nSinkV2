import { BaseMail } from '@adonisjs/mail'

/**
 * Your account has been deleted (plan §22.8.2).
 *
 * Takes the address rather than a user: by the time this is sent, the user
 * row's address has been overwritten. The address was kept on the request
 * just long enough to send this, and cleared as it was queued.
 */
export default class PrivacyDeletionCompletedNotification extends BaseMail {
  /**
   * `workspace_deleted` is for somebody who did not ask: the owner of their
   * workspace was deleted, and the workspace and its members went with them.
   */
  constructor(
    private address: string,
    private because: 'requested' | 'workspace_deleted' = 'requested'
  ) {
    super()
  }

  prepare() {
    this.message
      .to(this.address)
      .subject('Your account has been deleted')
      .htmlView('emails/privacy_deletion_completed', { because: this.because })
      .textView('emails/privacy_deletion_completed_text', { because: this.because })
  }
}
