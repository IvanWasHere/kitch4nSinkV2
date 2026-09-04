import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import { addMember, createWorkspace } from '#tests/helpers'

test.group('Workspace settings', (group) => {
  group.each.setup(() => {
    mail.fake()
    return () => mail.restore()
  })

  test('the owner can rename the workspace', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()

    const response = await client
      .post('/settings/organization')
      .loginAs(user)
      .form({ name: 'Renamed Workspace' })
      .withCsrfToken()
      .redirects(0)

    response.assertHeader('location', '/settings/organization')

    await organization.refresh()
    assert.equal(organization.name, 'Renamed Workspace')
  })

  /**
   * A member sees the screen without the buttons, rather than a 403 — the
   * workspace's name and plan are not privileged information.
   */
  test('a member sees the settings but cannot change them', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const member = await addMember(organization, user, 'sam@example.com')

    const page = await client.get('/settings/organization').loginAs(member)
    page.assertStatus(200)
    page.assertTextIncludes(organization.publicId)
    page.assertTextIncludes('Only the workspace owner can change these')

    await client
      .post('/settings/organization')
      .loginAs(member)
      .form({ name: 'Member Rename' })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.notEqual(organization.name, 'Member Rename')
  })

  test('the slug is not changed by a rename', async ({ client, assert }) => {
    const { user, organization } = await createWorkspace()
    const originalSlug = organization.slug

    await client
      .post('/settings/organization')
      .loginAs(user)
      .form({ name: 'Something Completely Different' })
      .withCsrfToken()
      .redirects(0)

    await organization.refresh()
    assert.equal(organization.slug, originalSlug)
  })
})
