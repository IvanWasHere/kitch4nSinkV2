import { test } from '@japa/runner'

import User from '#models/user'
import { createWorkspace, enableTwoFactor, totpFor, TEST_PASSWORD } from '#tests/helpers'

/**
 * The flows a person walks through in a browser (plan §15).
 *
 * Kept to the handful that actually break: everything asserted here is
 * already covered by a functional test at the HTTP level, so what these add
 * is the layer those cannot see — that the form has the fields it posts, that
 * the CSRF token is on the page, that the assets load, and that the
 * Content-Security-Policy does not refuse our own scripts (M8).
 *
 * No build step is needed: outside production the assets come from Vite,
 * which is also why the policy has to allow its module server and its HMR
 * socket in the test environment (config/shield.ts) — a browser test is the
 * only thing in this suite that notices.
 */
test.group('Signing up', () => {
  test('creates an account and lands on the confirmation notice', async ({ visit }) => {
    const page = await visit('/signup')

    await page.fill('input[name="fullName"]', 'Jane Cooper')
    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="organizationName"]', 'Acme')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.fill('input[name="passwordConfirmation"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForURL('**/verify-email')
    await page.assertTextContains('body', 'Check your email')
  })

  /**
   * The page has scripts, and a Content-Security-Policy that only accepts the
   * ones carrying this response's nonce. If that ever comes apart, Alpine
   * never boots and every interactive control on every page is dead — so it
   * is asserted here, once, rather than discovered on a screen.
   */
  test('runs its own JavaScript under the content security policy', async ({ visit, assert }) => {
    const page = await visit('/signup')

    const violations: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) {
        violations.push(message.text())
      }
    })

    await page.reload()

    /**
     * Alpine is what makes the show/hide control on the password field work.
     * If the bundle was refused, the button is inert and the type never
     * changes.
     */
    await page.click('.pw-toggle')
    assert.equal(await page.getAttribute('input[name="password"]', 'type'), 'text')

    assert.deepEqual(violations, [])
  })
})

test.group('Signing in', () => {
  test('signs in and reaches the dashboard', async ({ visit }) => {
    await createWorkspace({ email: 'jane@example.com' })

    const page = await visit('/login')

    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForURL('**/dashboard')
    await page.assertTextContains('body', 'Overview')
  })

  test('shows the reason a wrong password was refused', async ({ visit }) => {
    await createWorkspace({ email: 'jane@example.com' })

    const page = await visit('/login')

    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="password"]', 'not-the-password')
    await page.click('button[type="submit"]')

    await page.waitForURL('**/login')
    await page.assertTextContains('body', 'Those credentials do not match our records.')
  })

  /**
   * The second factor is proved before a session exists, so this is two
   * navigations and one of them must not be skippable.
   */
  test('asks for the second factor before signing in', async ({ visit, assert }) => {
    const { user } = await createWorkspace({ email: 'jane@example.com' })
    const { secret } = await enableTwoFactor(user)

    const page = await visit('/login')

    await page.fill('input[name="email"]', 'jane@example.com')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForURL('**/two-factor')

    /**
     * The password alone got them here and no further: the dashboard is
     * still closed.
     */
    await page.goto(page.url().replace('/two-factor', '/dashboard'))
    assert.include(page.url(), '/login')

    const challenge = await visit('/two-factor')
    await challenge.fill('input[name="code"]', await totpFor(secret))
    await challenge.click('button[type="submit"]')

    await challenge.waitForURL('**/dashboard')
  })
})

test.group('Accepting an invitation', () => {
  test('joins the workspace from the emailed link', async ({ visit }) => {
    const { user, organization } = await createWorkspace({ email: 'owner@example.com' })

    const { default: invitations } = await import('#organizations/invitation_service')
    const { token } = await invitations.invite({
      organization,
      invitedBy: user,
      email: 'sam@example.com',
    })

    /**
     * The link in the email. It checks the token before rendering anything,
     * then hands over the form (`InvitationAcceptanceController`).
     */
    const page = await visit(`/invitations/${token}`)

    await page.assertTextContains('body', organization.name)
    await page.fill('input[name="fullName"]', 'Sam Member')
    await page.fill('input[name="password"]', TEST_PASSWORD)
    await page.fill('input[name="passwordConfirmation"]', TEST_PASSWORD)
    await page.click('button[type="submit"]')

    await page.waitForURL('**/dashboard')

    const member = await User.findByOrFail('email', 'sam@example.com')
    await page.assertTextContains('body', member.displayName)
  })
})
