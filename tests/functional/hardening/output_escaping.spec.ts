import { test } from '@japa/runner'

import { createStaff, createWorkspace, TEST_PASSWORD } from '#tests/helpers'

const PAYLOAD = '<img src=x onerror="alert(1)">'

/**
 * Escaping regressions, pinned.
 *
 * Several flash messages are built from something a person typed — a list
 * name, a file name, an address — and the toast that renders them used to
 * print its `text` prop raw. So did the textarea, which is worse: old input
 * containing `</textarea>` closes the element and everything after it is
 * markup.
 *
 * These are cheap to keep and would have caught both.
 */
test.group('Output escaping', () => {
  test('escapes a flash message built from what somebody typed', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    /**
     * The exact message `ListController` flashes after a list is created,
     * seeded onto the request because a flash does not survive between two
     * calls of the test client.
     */
    const page = await client
      .get('/lists')
      .loginAs(user)
      .withFlashMessages({ success: `"${PAYLOAD}" is ready.` })

    /**
     * The toast quotes the name. It must arrive as text — the tag itself
     * must never reach the markup.
     */
    assert.include(page.text(), '&lt;img src=x')
    assert.notInclude(page.text(), '<img src=x')
  })

  test('escapes a list name rendered on the page', async ({ client, assert }) => {
    const { user } = await createWorkspace()

    await client.post('/lists').form({ name: PAYLOAD }).loginAs(user).withCsrfToken().redirects(0)

    const page = await client.get('/lists').loginAs(user)

    assert.notInclude(page.text(), 'onerror="alert(1)"')
  })

  /**
   * A textarea's content is text. Printed raw, `</textarea>` in old input
   * ends the element early and everything after it becomes markup — so the
   * one screen in this application with a textarea is where that is pinned.
   */
  test('escapes old input rendered back into a textarea', async ({ client, assert }) => {
    const staff = await createStaff()
    const breakout = '</textarea><img src=x>'

    /**
     * The state a rejected form leaves behind: what was typed, waiting to be
     * rendered back into the control. Seeded directly rather than produced by
     * a failed POST, because each request here carries its own cookie jar and
     * the flash would not survive the round trip.
     */
    const page = await client
      .get('/admin/notifications')
      .withGuard('staff')
      .loginAs(staff)
      .withFlashMessages({ body: breakout })

    assert.include(page.text(), '&lt;/textarea&gt;')
    assert.notInclude(page.text(), '</textarea><img src=x>')
  })
})

/**
 * A credential must not be parked in the session store on its way back to a
 * form (`app/auth/flash_input.ts`).
 */
test.group('Flashed input', () => {
  test('does not flash a password back after a failed sign-in', async ({ client }) => {
    await createWorkspace({ email: 'jane@example.com' })

    const response = await client
      .post('/login')
      .form({ email: 'jane@example.com', password: 'not-the-password' })
      .withCsrfToken()
      .redirects(0)

    /**
     * The address comes back so the form can be re-filled; the password does
     * not. Asserting both ways round matters — a test that only checks the
     * absence of a key passes just as well when nothing was flashed at all.
     */
    response.assertFlashMessage('email', 'jane@example.com')
    response.assertFlashMissing('password')
  })

  test('does not flash a password back after a rejected signup', async ({ client }) => {
    const response = await client
      .post('/signup')
      .form({
        fullName: 'Jane Cooper',
        email: 'not-an-address',
        password: TEST_PASSWORD,
        passwordConfirmation: TEST_PASSWORD,
      })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('email', 'not-an-address')
    response.assertFlashMissing('password')
    response.assertFlashMissing('passwordConfirmation')
  })
})
