import type { HttpContext } from '@adonisjs/core/http'

import Job from '#models/job'
import queue from '#queue/queue_service'

/**
 * The job queue screen in the back-office (plan §9, M3).
 *
 * The reason a database queue was chosen over Redis (D2) is that failures are
 * visible and recoverable without shelling into anything: this is that screen.
 */
export default class AdminJobController {
  async index({ view }: HttpContext) {
    const [counts, failed, pending] = await Promise.all([
      queue.counts(),
      queue.failedJobs(),
      queue.pendingJobs(),
    ])

    return view.render('pages/admin/jobs', { counts, failed, pending })
  }

  /**
   * Put one failed job back on the queue. Attempts reset, because a human has
   * decided the cause is fixed.
   */
  async retry({ params, response, session }: HttpContext) {
    const job = await Job.find(params.id)

    if (!job || !job.isFailed) {
      session.flash('error', 'That job is not waiting to be retried.')
      return response.redirect().toRoute('admin.jobs.index')
    }

    await queue.retry(job)

    session.flash('success', `${job.name} #${job.id} is queued for another attempt.`)
    return response.redirect().toRoute('admin.jobs.index')
  }

  /**
   * Discard a failed job. Only ever a failed one — deleting something still
   * due would silently drop work nobody knows is missing.
   */
  async destroy({ params, response, session }: HttpContext) {
    const job = await Job.find(params.id)

    if (!job || !job.isFailed) {
      session.flash('error', 'Only a failed job can be discarded.')
      return response.redirect().toRoute('admin.jobs.index')
    }

    await job.delete()

    session.flash('success', `${job.name} #${job.id} discarded.`)
    return response.redirect().toRoute('admin.jobs.index')
  }
}
