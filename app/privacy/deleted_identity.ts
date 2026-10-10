/**
 * What a deleted person's email address becomes (plan §22.8.2, D14).
 *
 * Users are never physically deleted: their row stays, so every foreign key
 * pointing at it — todos, tickets, audit entries — keeps meaning something,
 * and the address is replaced instead. It is built from the internal id,
 * which keeps it unique under the column's unique index.
 *
 * `deleteduser.com` is not ours, and may be somebody's. That is why
 * `MailerService` refuses to send to anything this function could have
 * produced: a stray notification to a deleted account must go nowhere, not
 * to a stranger.
 */
/**
 * What a deleted person's name becomes. The profile row stays, but nothing on
 * it still says who they were.
 */
export const DELETED_NAME = 'Deleted User'

const DELETED_EMAIL = /^email\d+@deleteduser\.com$/i

export function deletedEmailFor(userId: number): string {
  return `email${userId}@deleteduser.com`
}

export function isDeletedEmail(address: string): boolean {
  return DELETED_EMAIL.test(address.trim())
}
