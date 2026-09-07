import { DateTime } from 'luxon'

import User from '#models/user'
import Notification from '#models/notification'
import type Organization from '#models/organization'
import type StaffUser from '#models/staff_user'
import { appliesTo, type AudienceViewer } from '#notifications/audience'
import { normalizeAudience, type AudienceInput } from '#notifications/input'

/**
 * How many candidates a single query will consider.
 *
 * Announcements are staff-authored and rare — tens a year (plan §20.1) — so
 * this ceiling is never reached in practice. It is here because "never in
 * practice" is not a guarantee, and an unbounded fetch on every page load is
 * not something to leave to good behaviour.
 */
export const CANDIDATE_LIMIT = 50

export interface FeedEntry {
  notification: Notification

  /**
   * Published since this viewer last looked. Rendered as a highlight, and the
   * reason `seen_at` is read *before* it is stamped (plan §20.4).
   */
  isNew: boolean
}

/**
 * The notification feed, its unread count, and authoring (plan §20).
 *
 * The audience question is answered in exactly one place — `appliesTo` — and
 * this class is what feeds it. It deliberately does not re-implement the rule
 * in SQL: matching `planKeys` or `userIds` needs JSON operators, which
 * portability rule 5 forbids, so candidates are fetched and filtered in
 * memory (plan §20.4).
 */
export class NotificationService {
  /**
   * Everything live, newest first, with the audience already applied.
   */
  async feedFor(user: User, organization: Organization): Promise<FeedEntry[]> {
    const seenAt = user.notificationsSeenAt

    const live = await this.liveFor(user, organization)

    return live.map((notification) => ({
      notification,
      isNew: !seenAt || (notification.publishedAt !== null && notification.publishedAt > seenAt),
    }))
  }

  /**
   * How many apply to this viewer and are newer than their last visit — the
   * red dot.
   *
   * Runs on every authenticated page load, so the query is narrowed by
   * `seen_at` first: for somebody who looks regularly the candidate set is
   * empty and the in-memory filter never runs at all.
   *
   * **Strictly newer, and the one-second blind spot that comes with it.**
   * Timestamps are stored to the second (SQLite writes
   * `YYYY-MM-DD HH:MM:SS`), so an announcement published in the same second
   * that somebody happens to load a page gets no dot for that person. The
   * alternative — `>=` — would instead leave the dot lit on an announcement
   * they *just read*, which is a thing a user can actually notice. Between a
   * visible wrong answer and an invisible one, this takes the invisible one,
   * and the message itself is not lost: the feed shows every live
   * announcement regardless of `seen_at`, so it is still on their
   * announcements page. Announcements are staff-authored and rare, which is
   * what makes a one-second window an acceptable place to be imprecise.
   */
  async unreadCountFor(user: User, organization: Organization): Promise<number> {
    const candidates = await this.publishedSince(user.notificationsSeenAt)

    return candidates.filter((notification) =>
      appliesTo(notification, this.viewerFor(user, organization))
    ).length
  }

  /**
   * Record that this viewer has looked.
   *
   * Returns the value it replaced, because the page renders "new since your
   * last visit" from it — stamping first and rendering afterwards would show
   * nothing as new, ever.
   */
  async markSeen(user: User): Promise<DateTime | null> {
    const previous = user.notificationsSeenAt ?? null

    user.notificationsSeenAt = DateTime.utc()
    await user.save()

    return previous
  }

  /**
   * Everything live for this viewer, regardless of when they last looked.
   */
  private async liveFor(user: User, organization: Organization): Promise<Notification[]> {
    const candidates = await this.publishedSince(null)

    return candidates.filter((notification) =>
      appliesTo(notification, this.viewerFor(user, organization))
    )
  }

  /**
   * Live announcements, optionally only those published after a moment.
   *
   * Expiry and publication are filtered from the models rather than in SQL:
   * comparing a timestamp column against a bound value means different things
   * on SQLite and Postgres (CONTRIBUTING). `published_at is not null` is a
   * null check, not a comparison, so that one is safe to push down and does
   * most of the narrowing anyway.
   */
  private async publishedSince(after: DateTime | null): Promise<Notification[]> {
    const candidates = await Notification.query()
      .whereNotNull('published_at')
      .whereNull('deleted_at')
      .orderBy('published_at', 'desc')
      .orderBy('id', 'desc')
      .limit(CANDIDATE_LIMIT)

    return candidates.filter((notification) => {
      if (!notification.isLive) {
        return false
      }

      return !after || (notification.publishedAt !== null && notification.publishedAt > after)
    })
  }

  private viewerFor(user: User, organization: Organization): AudienceViewer {
    return { id: user.id, role: user.role, planKey: organization.planKey }
  }

  /**
   * The back-office list — everything, including drafts and expired ones.
   */
  async all(limit = 100): Promise<Notification[]> {
    return Notification.query().whereNull('deleted_at').orderBy('id', 'desc').limit(limit)
  }

  async find(publicId: string): Promise<Notification | null> {
    return Notification.query().where('public_id', publicId).whereNull('deleted_at').first()
  }

  async create(
    staff: StaffUser,
    input: {
      title: string
      body: string
      level?: Notification['level']
      audienceType: Notification['audienceType']
      audience?: AudienceInput
      actionLabel?: string | null
      actionUrl?: string | null
      publishNow?: boolean
      expiresAt?: DateTime | null
    }
  ): Promise<Notification> {
    return Notification.create({
      title: input.title.trim(),
      body: input.body.trim(),
      level: input.level ?? 'info',
      audienceType: input.audienceType,
      audience: normalizeAudience(input.audienceType, input.audience),
      actionLabel: input.actionLabel?.trim() || null,
      actionUrl: input.actionUrl?.trim() || null,
      /**
       * A draft by default is the wrong default for a form somebody just
       * filled in, so publishing is opt-*out*: the author ticks "save as
       * draft" if that is what they meant.
       */
      publishedAt: input.publishNow === false ? null : DateTime.utc(),
      expiresAt: input.expiresAt ?? null,
      createdByStaffId: staff.id,
    })
  }

  /**
   * Publish a draft. Separate from `create` because the two are different
   * decisions and only one of them reaches customers.
   */
  async publish(notification: Notification): Promise<void> {
    if (!notification.isDraft) {
      return
    }

    notification.publishedAt = DateTime.utc()
    await notification.save()
  }

  /**
   * Soft delete, like files and lists. It disappears from every screen
   * immediately; `PruneNotificationsJob` removes the row after 30 days, so an
   * announcement deleted by mistake is recoverable for a month.
   */
  async delete(notification: Notification): Promise<void> {
    notification.deletedAt = DateTime.utc()
    await notification.save()
  }

  /**
   * How many people an audience would reach, for the back-office to show
   * before anything is published.
   *
   * Counted from the same predicate the feed uses — a "reaches N people"
   * figure computed a second way would eventually disagree with who actually
   * sees it, and the disagreement would only surface after publishing.
   */
  async reachOf(notification: Pick<Notification, 'audienceType' | 'audience'>): Promise<number> {
    const users = await User.query().whereNull('deleted_at').preload('organization')

    return users.filter((user) =>
      appliesTo(notification, {
        id: user.id,
        role: user.role,
        planKey: user.organization?.planKey ?? 'free',
      })
    ).length
  }
}

export default new NotificationService()
