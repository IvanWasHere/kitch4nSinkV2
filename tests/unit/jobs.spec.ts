import { readdir } from 'node:fs/promises'

import { test } from '@japa/runner'

import jobs, { SCHEDULE_INTERVALS, isScheduleInterval } from '#queue/registry'
import type { JobHandler } from '#queue/contracts'

/**
 * The job registry (plan §9).
 *
 * Registration moved to `start/jobs.ts` so a feature's jobs leave with the
 * feature, and the registry itself no longer knows what jobs exist. That
 * makes "a handler that silently stopped being registered" a live failure
 * mode rather than an impossible one — the registry's own docblock says a
 * stranded job should be a loud failure, and these tests are what keep that
 * true.
 */
test.group('Job registry', () => {
  /**
   * The check the explicit registry exists to make possible: every handler in
   * `app/queue/jobs/` is registered.
   *
   * Reading the directory rather than listing the jobs here is the point — a
   * new job file that nobody registers fails this, and a registration deleted
   * without its file fails it too. Neither would fail anything else until a
   * customer's job sat in the queue forever.
   */
  test('every job on disk is registered', async ({ assert }) => {
    /**
     * Core's jobs plus every feature module's, because a module carries its
     * own (`app/modules/<name>/jobs/`) and the point of this test is that
     * none of them can go unregistered wherever they live.
     */
    const dirs = ['app/queue/jobs']

    for (const module of await readdir('app/modules', { withFileTypes: true })) {
      if (module.isDirectory()) {
        dirs.push(`app/modules/${module.name}/jobs`)
      }
    }

    const found: string[] = []

    for (const dir of dirs) {
      const entries = await readdir(dir).catch(() => [])

      for (const file of entries.filter((entry) => entry.endsWith('_job.ts'))) {
        const specifier = `${dir.replace(/^app\//, '#app/')}/${file.replace(/\.ts$/, '')}`
        const { default: handler } = (await import(specifier)) as { default: JobHandler<any> }

        found.push(`${dir}/${file}`)

        assert.strictEqual(
          jobs.handlerFor(handler.name),
          handler,
          `${dir}/${file} exports "${handler.name}" but start/jobs.ts does not register it`
        )
      }
    }

    assert.isNotEmpty(found, 'no job files found — have the directories moved?')

    /**
     * And nothing registered that no longer has a file behind it.
     */
    assert.equal(jobs.names().length, found.length, 'a registration has no file behind it')
  })

  test('an unknown name resolves to null rather than throwing', ({ assert }) => {
    assert.isNull(jobs.handlerFor('no_such_job'))

    /**
     * Not a typo: `jobs.name` rows written before a handler was renamed are
     * exactly the case this returns null for, so the worker can park them as
     * failed instead of crashing.
     */
    assert.isNull(jobs.handlerFor(''))
  })

  test('the daily sweep dispatches labelled work', ({ assert }) => {
    const due = jobs.due('daily')

    assert.isNotEmpty(due, 'start/jobs.ts scheduled nothing daily')

    for (const entry of due) {
      assert.isNotEmpty(entry.label, `${entry.handler.name} is scheduled with no label`)
      assert.strictEqual(jobs.handlerFor(entry.handler.name), entry.handler)
    }
  })

  test('nothing is scheduled on an interval no job asked for', ({ assert }) => {
    assert.isEmpty(jobs.due('5m'))
    assert.isEmpty(jobs.due('hourly'))
  })

  /**
   * `schedule:run` takes the interval from a cron line, so an unrecognised
   * one must be a refusal rather than a silent no-op — a typo in crontab
   * would otherwise look exactly like "nothing scheduled".
   */
  test('only the published intervals are accepted', ({ assert }) => {
    for (const interval of SCHEDULE_INTERVALS) {
      assert.isTrue(isScheduleInterval(interval), interval)
    }

    assert.isFalse(isScheduleInterval('weekly'))
    assert.isFalse(isScheduleInterval('Daily'))
    assert.isFalse(isScheduleInterval(''))
  })
})
