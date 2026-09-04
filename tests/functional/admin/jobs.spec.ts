import { test } from '@japa/runner'

import Job from '#models/job'
import queue from '#queue/queue_service'
import { StaffUserFactory } from '#database/factories/staff_user_factory'
import { createWorkspace, enableTwoFactor } from '#tests/helpers'

const handler = { name: 'test_job', queue: 'default' }

async function signedInStaff() {
  const staff = await StaffUserFactory.create()
  await enableTwoFactor(staff)
  return staff
}

test.group('Admin job queue', () => {
  test('lists failed and pending jobs', async ({ client }) => {
    const staff = await signedInStaff()

    await queue.dispatch(handler, { note: 'waiting' })
    const failing = await queue.dispatch(handler, {}, { maxAttempts: 1 })
    await queue.fail(failing, new Error('the provider said no'))

    const response = await client.get('/admin/jobs').withGuard('staff').loginAs(staff)

    response.assertStatus(200)
    response.assertTextIncludes('test_job')
    response.assertTextIncludes('the provider said no')
  })

  /**
   * The reason a database queue was chosen over Redis (D2) is that a failure
   * is visible and recoverable without shelling into anything.
   */
  test('retries a failed job', async ({ client, assert }) => {
    const staff = await signedInStaff()
    const job = await queue.dispatch(handler, {}, { maxAttempts: 1 })
    await queue.fail(job, new Error('nope'))

    const response = await client
      .post(`/admin/jobs/${job.id}/retry`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/admin/jobs')

    await job.refresh()
    assert.isFalse(job.isFailed)
    assert.equal(job.attempts, 0)
  })

  test('discards a failed job', async ({ client, assert }) => {
    const staff = await signedInStaff()
    const job = await queue.dispatch(handler, {}, { maxAttempts: 1 })
    await queue.fail(job, new Error('nope'))

    await client
      .post(`/admin/jobs/${job.id}/discard`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    assert.isNull(await Job.find(job.id))
  })

  /**
   * Discarding something still due would silently drop work nobody knows is
   * missing.
   */
  test('refuses to discard a job that has not failed', async ({ client, assert }) => {
    const staff = await signedInStaff()
    const job = await queue.dispatch(handler, {})

    await client
      .post(`/admin/jobs/${job.id}/discard`)
      .withGuard('staff')
      .loginAs(staff)
      .withCsrfToken()
      .redirects(0)

    assert.isNotNull(await Job.find(job.id))
  })

  test('is closed to tenants', async ({ client }) => {
    const { user } = await createWorkspace()

    const response = await client.get('/admin/jobs').loginAs(user).redirects(0)

    response.assertHeader('location', '/admin/login')
  })

  test('is closed to anonymous visitors', async ({ client }) => {
    const response = await client.get('/admin/jobs').redirects(0)

    response.assertHeader('location', '/admin/login')
  })
})
