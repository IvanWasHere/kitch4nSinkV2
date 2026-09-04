import { DateTime } from 'luxon'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

import Job from '#models/job'
import queue, { DEFAULT_MAX_ATTEMPTS, VISIBILITY_TIMEOUT_SECONDS } from '#queue/queue_service'
import { UnrecoverableJobError } from '#queue/contracts'

const handler = { name: 'test_job', queue: 'default' }

test.group('QueueService', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('dispatches a job that is immediately due', async ({ assert }) => {
    const job = await queue.dispatch(handler, { hello: 'world' })

    assert.equal(job.name, 'test_job')
    assert.deepEqual(job.payload, { hello: 'world' })
    assert.equal(job.attempts, 0)
    assert.equal(job.maxAttempts, DEFAULT_MAX_ATTEMPTS)
    assert.isTrue(job.isDue)
  })

  test('a delayed job is not due yet', async ({ assert }) => {
    const job = await queue.dispatch(handler, {}, { delaySeconds: 600 })

    assert.isFalse(job.isDue)
    assert.lengthOf(await queue.reserve('default', 10), 0)
  })

  test('reserves due jobs in order', async ({ assert }) => {
    const first = await queue.dispatch(handler, { n: 1 })
    const second = await queue.dispatch(handler, { n: 2 })

    const reserved = await queue.reserve('default', 2)

    assert.deepEqual(
      reserved.map((job) => job.id),
      [first.id, second.id]
    )
  })

  test('a reserved job is not handed out twice', async ({ assert }) => {
    await queue.dispatch(handler, {})

    const first = await queue.reserve('default', 5)
    const second = await queue.reserve('default', 5)

    assert.lengthOf(first, 1)
    assert.lengthOf(second, 0)
  })

  /**
   * The property the whole design rests on: two workers polling at the same
   * instant must not both get the same job. Reservation is a compare-and-swap,
   * so exactly one update can touch the row.
   */
  test('concurrent workers never claim the same job', async ({ assert }) => {
    await queue.dispatch(handler, {})

    const [a, b] = await Promise.all([queue.reserve('default', 1), queue.reserve('default', 1)])

    assert.equal(a.length + b.length, 1, 'exactly one worker got it')
  })

  test('does not cross queues', async ({ assert }) => {
    await queue.dispatch({ name: 'mail_job', queue: 'mail' }, {})

    assert.lengthOf(await queue.reserve('default', 5), 0)
    assert.lengthOf(await queue.reserve('mail', 5), 1)
  })

  test('completing removes the row', async ({ assert }) => {
    const job = await queue.dispatch(handler, {})
    await queue.complete(job)

    assert.isNull(await Job.find(job.id))
  })

  test('a failure schedules another attempt with exponential backoff', async ({ assert }) => {
    const job = await queue.dispatch(handler, {})
    const before = DateTime.utc()

    await queue.fail(job, new Error('provider was rude'))

    assert.equal(job.attempts, 1)
    assert.isFalse(job.isFailed)
    assert.include(job.lastError!, 'provider was rude')
    assert.isFalse(job.isReserved, 'and it is handed back')
    assert.isAtLeast(job.availableAt.toMillis(), before.plus({ seconds: 59 }).toMillis())
  })

  test('backoff grows with each attempt', ({ assert }) => {
    assert.equal(queue.backoffSeconds(1), 60)
    assert.equal(queue.backoffSeconds(2), 120)
    assert.equal(queue.backoffSeconds(3), 240)
    assert.equal(queue.backoffSeconds(4), 480)
  })

  test('the final attempt parks the job as failed', async ({ assert }) => {
    const job = await queue.dispatch(handler, {}, { maxAttempts: 2 })

    await queue.fail(job, new Error('once'))
    assert.isFalse(job.isFailed)

    await queue.fail(job, new Error('twice'))
    assert.isTrue(job.isFailed)
    assert.equal(job.status, 'failed')
  })

  test('a failed job is never reserved again', async ({ assert }) => {
    const job = await queue.dispatch(handler, {}, { maxAttempts: 1 })
    await queue.fail(job, new Error('nope'))

    assert.lengthOf(await queue.reserve('default', 5), 0)
  })

  /**
   * Some failures can never succeed — a payload naming a handler that no
   * longer exists, say. Retrying those four more times only delays the
   * moment somebody sees them.
   */
  test('an unrecoverable failure skips the remaining attempts', async ({ assert }) => {
    const job = await queue.dispatch(handler, {}, { maxAttempts: 5 })

    await queue.fail(job, new UnrecoverableJobError('no handler'))

    assert.isTrue(job.isFailed)
    assert.equal(job.attempts, 1)
  })

  test('retrying clears the failure and requeues', async ({ assert }) => {
    const job = await queue.dispatch(handler, {}, { maxAttempts: 1 })
    await queue.fail(job, new Error('nope'))

    await queue.retry(job)

    assert.isFalse(job.isFailed)
    assert.equal(job.attempts, 0)
    assert.isNull(job.lastError)
    assert.lengthOf(await queue.reserve('default', 5), 1)
  })

  /**
   * Crash recovery: a worker that dies holding a job must not take the job
   * with it. This is also why every handler has to be idempotent — the work
   * may already have happened.
   */
  test('a stale reservation is reclaimed', async ({ assert }) => {
    const job = await queue.dispatch(handler, {})
    const [reserved] = await queue.reserve('default', 1)

    assert.lengthOf(await queue.reserve('default', 1), 0)

    reserved.reservedAt = DateTime.utc().minus({ seconds: VISIBILITY_TIMEOUT_SECONDS + 60 })
    await reserved.save()

    const reclaimed = await queue.reserve('default', 1)

    assert.lengthOf(reclaimed, 1)
    assert.equal(reclaimed[0].id, job.id)
  })

  test('a fresh reservation is left alone', async ({ assert }) => {
    await queue.dispatch(handler, {})
    await queue.reserve('default', 1)

    assert.equal(await queue.reclaimExpired('default'), 0)
  })

  test('counts split by state', async ({ assert }) => {
    await queue.dispatch(handler, {})
    await queue.dispatch(handler, {})
    const failing = await queue.dispatch(handler, {}, { maxAttempts: 1 })
    await queue.fail(failing, new Error('nope'))

    await queue.reserve('default', 1)

    const counts = await queue.counts()

    assert.equal(counts.pending, 1)
    assert.equal(counts.reserved, 1)
    assert.equal(counts.failed, 1)
  })
})
