import type { JobHandler } from '#queue/contracts'

/**
 * The job registry (plan §9).
 *
 * Two questions, one place: which handler runs a job named in `jobs.name`,
 * and which jobs a given cron tick should dispatch.
 *
 * Registration is explicit rather than by directory scanning, and that has
 * not changed — a job whose handler has silently disappeared should be a loud
 * "unknown job" failure the admin panel shows, not a job that is quietly
 * never picked up. What has changed is *where*: every job this application
 * has is registered in `start/jobs.ts`, so a feature's jobs leave with the
 * feature instead of being listed in core (docs/modules.md).
 */
export const SCHEDULE_INTERVALS = ['5m', 'hourly', 'daily'] as const

export type ScheduleInterval = (typeof SCHEDULE_INTERVALS)[number]

export function isScheduleInterval(value: string): value is ScheduleInterval {
  return (SCHEDULE_INTERVALS as readonly string[]).includes(value)
}

export interface JobSchedule {
  /**
   * Which cron tick dispatches it. System cron drives `schedule:run` once per
   * interval (plan §9), so this is the whole of a job's scheduling.
   */
  interval: ScheduleInterval

  /**
   * What `schedule:run` prints — "reconcile todo counters", not the job's
   * stable `name`, because the operator reading that output wants to know
   * what ran rather than what it is keyed as.
   */
  label: string
}

export class JobRegistry {
  #jobs = new Map<string, { handler: JobHandler<any>; schedule?: JobSchedule }>()

  /**
   * Register a handler, optionally on a schedule.
   *
   * Keyed on `handler.name` — the identifier stored in `jobs.name` — so
   * registering twice under the same name replaces rather than duplicates.
   */
  register(handler: JobHandler<any>, schedule?: JobSchedule): this {
    this.#jobs.set(handler.name, { handler, schedule })
    return this
  }

  handlerFor(name: string): JobHandler<any> | null {
    return this.#jobs.get(name)?.handler ?? null
  }

  names(): string[] {
    return [...this.#jobs.keys()]
  }

  /**
   * What a cron tick should dispatch, in registration order.
   */
  due(interval: ScheduleInterval): { label: string; handler: JobHandler<any> }[] {
    return [...this.#jobs.values()]
      .filter((entry) => entry.schedule?.interval === interval)
      .map((entry) => ({ label: entry.schedule!.label, handler: entry.handler }))
  }

  reset(): this {
    this.#jobs.clear()
    return this
  }
}

const registry = new JobRegistry()

export default registry

/**
 * A function rather than the map it reads, because it is the one thing the
 * worker (`commands/queue_work.ts`) and the test helper need, and a `null`
 * for an unknown name is what turns a stranded job into a reported failure
 * instead of a crash.
 */
export function handlerFor(name: string): JobHandler<any> | null {
  return registry.handlerFor(name)
}
