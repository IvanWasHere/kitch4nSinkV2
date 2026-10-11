import type { DemoSeeder } from '#seeding/demo_seeders'

/**
 * The Privacy module's share of `node ace dev:seed` (plan §22.8).
 *
 * One request in each state the back-office list has a filter for: an export
 * that can be downloaded, one that expired, one that failed, a deletion
 * waiting for an admin and one that was turned down. Registered in
 * `start/seeders.ts`, so removing the module takes its demo rows with it.
 *
 * No completed deletion: that needs an account that is gone, and every
 * account the demo makes is one somebody signs in with.
 */
export const privacyDemoSeeder: DemoSeeder = {
  key: 'privacy',

  async seed({ free, pro }) {
    const { DateTime } = await import('luxon')
    const { default: StaffUser } = await import('#models/staff_user')
    const { default: PrivacyRequest } = await import('#modules/privacy/models/privacy_request')
    const { buildExport } = await import('#modules/privacy/services/export_builder')
    const { default: storage } = await import('#storage/disk_storage')

    const admin = await StaffUser.findBy('email', 'admin@example.com')
    const now = DateTime.utc()

    /* Expired: built a month ago, and the archive has since been purged. */
    await PrivacyRequest.create({
      userId: free.owner.id,
      type: 'export',
      status: 'expired',
      requestedAt: now.minus({ days: 31 }),
      startedAt: now.minus({ days: 31 }),
      completedAt: now.minus({ days: 31 }),
      downloadedAt: now.minus({ days: 30 }),
      exportSizeBytes: 18_432,
    })

    /* Turned down by an admin, with the reason the person is shown. */
    const [member] = free.members

    if (member) {
      await PrivacyRequest.create({
        userId: member.id,
        type: 'deletion',
        status: 'rejected',
        requestedAt: now.minus({ days: 9 }),
        confirmedAt: now.minus({ days: 9 }),
        rejectionReason: 'Asked from a shared mailbox — please confirm from your own address.',
        processedByStaffId: admin?.id ?? null,
      })
    }

    const [first, second] = pro.members

    /* Failed on its last attempt: the page offers staff a retry. */
    if (second) {
      await PrivacyRequest.create({
        userId: second.id,
        type: 'export',
        status: 'failed',
        requestedAt: now.minus({ days: 2 }),
        startedAt: now.minus({ days: 2 }),
        failureReason: 'The archive could not be built. The error is in the worker log.',
      })
    }

    /* Waiting for an admin: confirmed by the person, not yet approved. */
    if (first) {
      await PrivacyRequest.create({
        userId: first.id,
        type: 'deletion',
        status: 'confirmed',
        requestedAt: now.minus({ hours: 20 }),
        confirmedAt: now.minus({ hours: 20 }),
      })
    }

    /**
     * Ready to download — built for real, so the link on the page works.
     * Through the builder rather than `PrivacyService.generate`, which would
     * also email the person that it is ready.
     */
    const ready = await PrivacyRequest.create({
      userId: pro.owner.id,
      type: 'export',
      status: 'processing',
      requestedAt: now.minus({ hours: 3 }),
      startedAt: now.minus({ hours: 3 }),
    })
    const built = await buildExport(pro.owner, ready.publicId)

    try {
      const key = `privacy/${ready.publicId}.zip`

      await storage.moveFromTmp({
        tmpPath: built.path,
        disk: 'private',
        key,
        contentType: 'application/zip',
      })

      ready.merge({
        status: 'completed',
        completedAt: now.minus({ hours: 3 }),
        exportKey: key,
        exportSizeBytes: built.sizeBytes,
        exportExpiresAt: now.plus({ days: 7 }),
      })
      await ready.save()
    } finally {
      await built.cleanup()
    }
  },
}
