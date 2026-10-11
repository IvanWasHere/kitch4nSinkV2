import type { DemoSeeder } from '#seeding/demo_seeders'

/**
 * Registration Control's share of `node ace dev:seed` (plan §22.5).
 *
 * A waiting list with somebody in every state, so each filter on the admin
 * screen has a row behind it. Registration itself is left open: the demo
 * accounts are toured by signing up as well as signing in. Registered in
 * `start/seeders.ts`, so removing the module takes its demo rows with it.
 */
export const registrationControlDemoSeeder: DemoSeeder = {
  key: 'registration_control',

  async seed() {
    const { DateTime } = await import('luxon')
    const { default: WaitingListEntry } =
      await import('#modules/registration_control/models/waiting_list_entry')

    const now = DateTime.utc()

    /**
     * Newest first, as the screen lists them. `confirmedAfterHours` is null
     * for somebody who has not followed their link.
     */
    const entries = [
      ['noor@lakeshore.example', 'pending_confirmation', 3, null, true],
      ['felix@quarry.example', 'confirmed', 9, 1, true],
      ['amara@tidewater.example', 'confirmed', 26, 2, true],
      ['hello@birchandco.example', 'pending_confirmation', 41, null, true],
      ['dmitri@northpier.example', 'confirmed', 70, 0, false],
      ['sofia@greenline.example', 'converted', 120, 5, true],
      ['ops@harbourworks.example', 'cancelled', 150, 3, true],
      ['lena@foxglove.example', 'confirmed', 190, 12, true],
      ['marcus@ironbridge.example', 'converted', 260, 1, true],
    ] as const

    for (const [email, status, hoursAgo, confirmedAfterHours, doubleOptIn] of entries) {
      const joinedAt = now.minus({ hours: hoursAgo })
      const confirmedAt =
        confirmedAfterHours === null ? null : joinedAt.plus({ hours: confirmedAfterHours })

      await WaitingListEntry.create({
        email,
        status,
        doubleOptInRequired: doubleOptIn,
        confirmedAt,
        convertedAt: status === 'converted' ? joinedAt.plus({ days: 2 }) : null,
        createdAt: joinedAt,
        updatedAt: confirmedAt ?? joinedAt,
      })
    }
  },
}
