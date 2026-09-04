/*
|--------------------------------------------------------------------------
| Authentication routes
|--------------------------------------------------------------------------
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

/**
 * Signed-out flows.
 */
router
  .group(() => {
    router.get('/signup', [controllers.auth.Registration, 'create']).as('auth.register.create')
    router.post('/signup', [controllers.auth.Registration, 'store']).as('auth.register.store')

    router.get('/login', [controllers.auth.Session, 'create']).as('auth.session.create')
    router.post('/login', [controllers.auth.Session, 'store']).as('auth.session.store')

    router
      .get('/forgot-password', [controllers.auth.PasswordReset, 'create'])
      .as('auth.password.create')
    router
      .post('/forgot-password', [controllers.auth.PasswordReset, 'store'])
      .as('auth.password.store')
    router
      .get('/reset-password/:token', [controllers.auth.PasswordReset, 'edit'])
      .as('auth.password.edit')
    router
      .post('/reset-password/:token', [controllers.auth.PasswordReset, 'update'])
      .as('auth.password.update')

    /**
     * The second factor is proved *before* a session exists, so these sit in
     * the guest group — `pendingTwoFactorChallenge` is the gate, not the auth
     * guard.
     */
    router
      .get('/two-factor', [controllers.auth.TwoFactorChallenge, 'create'])
      .as('auth.two_factor.create')
    router
      .post('/two-factor', [controllers.auth.TwoFactorChallenge, 'store'])
      .as('auth.two_factor.store')

    router
      .get('/auth/:provider/redirect', [controllers.auth.SocialAuth, 'redirect'])
      .as('auth.social.redirect')
    router
      .get('/auth/:provider/callback', [controllers.auth.SocialAuth, 'callback'])
      .as('auth.social.callback')
  })
  .use(middleware.guest())

/**
 * Accepting an invitation.
 *
 * Outside the guest group: the recipient may already be signed in to a
 * different workspace, and they need to be told that plainly rather than
 * silently redirected to a dashboard that is not the one they were invited to.
 */
router
  .get('/invitations/:token', [controllers.auth.InvitationAcceptance, 'show'])
  .as('invitations.show')
router
  .get('/invitations/:token/accept', [controllers.auth.InvitationAcceptance, 'form'])
  .as('invitations.form')
router
  .post('/invitations/:token/accept', [controllers.auth.InvitationAcceptance, 'accept'])
  .as('invitations.accept')

/**
 * Following a confirmation link must work in a browser that has never seen
 * this site, so it is outside both the guest and the auth groups.
 */
router
  .get('/verify-email/:token', [controllers.auth.EmailVerification, 'verify'])
  .as('auth.verify_email.verify')

/**
 * Signed in, but not necessarily verified.
 */
router
  .group(() => {
    router.post('/logout', [controllers.auth.Session, 'destroy']).as('auth.session.destroy')

    router
      .get('/verify-email', [controllers.auth.EmailVerification, 'notice'])
      .as('auth.verify_email.notice')
    router
      .post('/verify-email/resend', [controllers.auth.EmailVerification, 'resend'])
      .as('auth.verify_email.resend')
  })
  .use(middleware.auth())
