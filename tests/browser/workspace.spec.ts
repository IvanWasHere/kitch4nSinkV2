import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'

import File from '#models/file'
import TodoList from '#models/todo_list'
import {
  clearStorage,
  createWorkspace,
  restorePaymentProvider,
  useFakePaymentProvider,
  TEST_PASSWORD,
} from '#tests/helpers'

/**
 * The flows in the application that a functional test cannot fully stand in
 * for (plan §15): one leaves for a payment provider, one carries a real file
 * through a real `multipart/form-data` submission, and one is only reachable
 * through a <dialog> that a browser has to open.
 */
test.group('Upgrading a plan', (group) => {
  group.each.setup(() => {
    const fake = useFakePaymentProvider()

    return () => {
      restorePaymentProvider()
      void fake
    }
  })

  test('hands the owner off to the provider', async ({ visit, browserContext, assert }) => {
    await createWorkspace({ email: 'jane@example.com' })

    /**
     * The fake provider's checkout URL points at a host that does not exist,
     * so it is answered here — the test is about the handoff, and nothing
     * should leave the machine to prove it.
     */
    await browserContext.route('https://checkout.test/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: 'provider checkout' })
    })

    const page = await visit('/login')
    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')

    await page.goto('/billing')
    await page.click('#checkout-pro button[type="submit"]')

    await page.waitForURL('https://checkout.test/**')

    /**
     * Which product they were sent to matters: this is the mapping from a
     * plan key to a provider product id (§7.3), and getting it wrong sells
     * somebody the wrong thing.
     *
     * That the browser got here at all is the other half. A form POST that
     * answers with a redirect off-site is subject to `form-action`, which is
     * enforced across the redirect and fails silently — no error page, no
     * exception, just a button that does nothing (config/shield.ts).
     */
    assert.include(page.url(), 'prod_test_pro')
  })

  /**
   * Nothing is granted on the way back — the webhook is the source of truth
   * — so the return screen must say so rather than showing the new plan.
   */
  test('the return screen waits rather than granting the plan', async ({ visit, assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })

    const page = await visit('/login')
    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')

    await page.goto('/billing/return')

    /**
     * Rendered by Alpine from an `x-if` template, so this also proves the
     * bundle ran — a screen that polls is worthless if its JavaScript was
     * refused.
     */
    await page.assertTextContains('body', 'Activating your subscription')

    /**
     * And nothing was granted: the plan still says what it said before
     * checkout (§7.5).
     */
    await user.refresh()
    await user.load('organization')
    assert.equal(user.organization.planKey, 'free')
  })
})

test.group('Uploading a file', (group) => {
  group.each.setup(() => {
    mail.fake()

    return async () => {
      mail.restore()
      await clearStorage()
    }
  })

  test('uploads a file and lists it', async ({ visit, assert }) => {
    await createWorkspace({ email: 'jane@example.com' })

    const page = await visit('/login')
    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')

    await page.goto('/files')

    /**
     * The input is visually hidden behind the drop zone — the drop zone is
     * Alpine sugar over a plain file input, which is the point of building
     * it that way (plan §13.3), and it is the input a browser actually
     * submits.
     */
    await page.setInputFiles('input[type="file"]', {
      name: 'quarterly-report.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('the numbers went up'),
    })

    await page.click('button[type="submit"]:has-text("Upload")')

    await page.waitForURL('**/files')
    await page.assertTextContains('body', 'quarterly-report.txt')

    /**
     * And it is a row, not just a toast: the file is recorded against the
     * organisation with the name the person recognises.
     */
    const stored = await File.query().firstOrFail()
    assert.equal(stored.originalName, 'quarterly-report.txt')
  })

  test('refuses a file type that is not allowed', async ({ visit }) => {
    await createWorkspace({ email: 'jane@example.com' })

    const page = await visit('/login')
    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')

    await page.goto('/files')

    await page.setInputFiles('input[type="file"]', {
      name: 'payload.html',
      mimeType: 'text/html',
      buffer: Buffer.from('<script>alert(1)</script>'),
    })

    await page.click('button[type="submit"]:has-text("Upload")')

    await page.waitForURL('**/files')
    await page.assertTextContains('body', 'That kind of file is not accepted')
  })
})

/*
| Creating a list happens inside a modal, and the two controls that open and
| close it are the only part of the flow a functional test never touches: it
| POSTs to `lists.store` directly and passes whether or not anything on the
| page can reach that form.
|
| Both had been broken that way. The button opened the dialog from an inline
| `onclick`, which the Content-Security-Policy refuses to run, and the close
| button called `$el.close()` where `$el` was the button rather than the
| <dialog>.
*/
test.group('Creating a list', () => {
  test('opens the modal, creates the list, and closes on Cancel', async ({ visit, assert }) => {
    const { organization } = await createWorkspace({ email: 'jane@example.com' })

    const page = await visit('/login')
    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/dashboard')

    await page.goto('/lists')

    /**
     * The dialog is in the DOM from the start and inert until something calls
     * `showModal()` on it, so "is it open" is the assertion that matters.
     */
    await page.click('button:has-text("New list")')
    await page.waitForSelector('#new-list[open]')

    await page.fill('#new-list input[name="name"]', 'Launch checklist')
    await page.click('#new-list button:has-text("Create list")')

    await page.assertTextContains('body', 'Launch checklist')

    const list = await TodoList.query().where('organization_id', organization.id).firstOrFail()
    assert.equal(list.name, 'Launch checklist')

    await page.goto('/lists')
    await page.click('button:has-text("New list")')
    await page.waitForSelector('#new-list[open]')
    await page.click('#new-list button:has-text("Cancel")')

    /* A <dialog> that is not open is not rendered, so "hidden" is "closed". */
    await page.waitForSelector('#new-list', { state: 'hidden' })
  })
})
