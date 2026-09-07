import { DateTime } from 'luxon'
import type { HttpContext } from '@adonisjs/core/http'

import notifications from '#notifications/notification_service'
import audit, { AUDIT_ACTIONS } from '#audit/audit_service'
import { describeAudience } from '#notifications/audience'
import { plans } from '#config/plans'
import { createNotificationValidator } from '#validators/admin'

/**
 * Authoring announcements (plan §20.5, §20.6).
 *
 * Support can read this list — "did they get told?" is a support question —
 * but only an admin may write one, because an announcement reaches customers
 * and cannot be unread.
 */
export default class AdminNotificationController {
  async index({ view, staffBouncer }: HttpContext) {
    await staffBouncer.with('StaffPolicy').authorize('view')

    const all = await notifications.all()

    /**
     * The reach of each one, from the same predicate the feed uses. A
     * second way of counting would eventually disagree with who actually
     * sees it, and the disagreement would only surface after publishing.
     */
    const reach = new Map<number, number>()

    for (const notification of all) {
      reach.set(notification.id, await notifications.reachOf(notification))
    }

    return view.render('pages/admin/notifications/index', {
      notifications: all,
      reach,
      describeAudience,
      planKeys: Object.keys(plans),
      canManage: await staffBouncer.with('StaffPolicy').allows('manageNotifications'),
    })
  }

  async store(ctx: HttpContext) {
    const { request, response, session, staffBouncer, auth } = ctx
    await staffBouncer.with('StaffPolicy').authorize('manageNotifications')

    const payload = await request.validateUsing(createNotificationValidator)

    /**
     * Half a call to action is worse than none: a label with no URL renders a
     * button that does nothing.
     */
    if (Boolean(payload.actionLabel) !== Boolean(payload.actionUrl)) {
      session.flash('error', 'A call to action needs both a label and a URL, or neither.')
      return response.redirect().back()
    }

    const expiresAt = payload.expiresAt ? DateTime.fromISO(payload.expiresAt) : null

    if (payload.expiresAt && (!expiresAt || !expiresAt.isValid)) {
      session.flash('error', 'That expiry date could not be read.')
      return response.redirect().back()
    }

    const notification = await notifications.create(auth.use('staff').user!, {
      title: payload.title,
      body: payload.body,
      level: payload.level,
      audienceType: payload.audienceType,
      audience: {
        planKeys: request.input('planKeys'),
        userIds: request.input('userIds'),
      },
      actionLabel: payload.actionLabel ?? null,
      actionUrl: payload.actionUrl ?? null,
      publishNow: !payload.saveAsDraft,
      expiresAt,
    })

    const reach = await notifications.reachOf(notification)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.notificationCreated,
      subjectType: 'Notification',
      subjectId: notification.publicId,
      metadata: {
        title: notification.title,
        audience: describeAudience(notification),
        reach,
        draft: notification.isDraft,
      },
    })

    /**
     * The reach is in the flash as well as the audit entry, because "who did
     * that actually go to" is the question somebody asks themselves
     * immediately after pressing the button.
     */
    session.flash(
      'success',
      notification.isDraft
        ? `Saved as a draft. It reaches nobody until you publish it.`
        : `Published to ${reach} ${reach === 1 ? 'person' : 'people'}.`
    )

    return response.redirect().toRoute('admin.notifications.index')
  }

  async publish(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('manageNotifications')

    const notification = await notifications.find(params.id)

    if (!notification) {
      session.flash('error', 'That announcement no longer exists.')
      return response.redirect().toRoute('admin.notifications.index')
    }

    if (!notification.isDraft) {
      session.flash('error', 'That one is already published.')
      return response.redirect().back()
    }

    await notifications.publish(notification)

    const reach = await notifications.reachOf(notification)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.notificationPublished,
      subjectType: 'Notification',
      subjectId: notification.publicId,
      metadata: { title: notification.title, reach },
    })

    session.flash('success', `Published to ${reach} ${reach === 1 ? 'person' : 'people'}.`)
    return response.redirect().toRoute('admin.notifications.index')
  }

  /**
   * Soft delete: it leaves every screen at once and is recoverable for 30
   * days, the same shape as a deleted file.
   *
   * Deleting does not un-read it. Anybody who already saw it, saw it — which
   * is worth saying in the flash, because "delete" on a one-way
   * announcement invites the assumption that it can be taken back.
   */
  async destroy(ctx: HttpContext) {
    const { params, response, session, staffBouncer } = ctx
    await staffBouncer.with('StaffPolicy').authorize('manageNotifications')

    const notification = await notifications.find(params.id)

    if (!notification) {
      session.flash('error', 'That announcement no longer exists.')
      return response.redirect().toRoute('admin.notifications.index')
    }

    await notifications.delete(notification)

    await audit.recordStaffAction(ctx, {
      action: AUDIT_ACTIONS.notificationDeleted,
      subjectType: 'Notification',
      subjectId: notification.publicId,
      metadata: { title: notification.title, wasPublished: !notification.isDraft },
    })

    session.flash(
      'success',
      notification.isDraft
        ? `"${notification.title}" deleted.`
        : `"${notification.title}" is off every screen. Anyone who already read it still read it.`
    )

    return response.redirect().toRoute('admin.notifications.index')
  }
}
