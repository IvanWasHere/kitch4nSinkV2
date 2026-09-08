import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * The response headers Shield does not send (plan §16, M8).
 *
 * Shield covers CSP, HSTS, `X-Frame-Options` and `X-Content-Type-Options`
 * (config/shield.ts). These four are the rest of the modern set, and they are
 * here rather than there because Shield has no configuration for them.
 *
 * On the **server** stack rather than the router stack, so a request that
 * never matches a route — a 404, a probe for `/wp-login.php` — is answered
 * with them too.
 */
export default class SecurityHeadersMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    /**
     * Send the origin, never the path, to another site.
     *
     * The default in most browsers is already this, but "most" is doing a
     * lot of work in that sentence and the paths here carry public ids: a
     * `Referer` of `/lists/lst_…` handed to whatever a customer pasted into
     * a todo is a small, permanent leak.
     */
    ctx.response.header('referrer-policy', 'strict-origin-when-cross-origin')

    /**
     * Nothing in this application uses the camera, the microphone, the
     * user's location or their payment handler, so nothing — including any
     * third-party frame that ever ends up on a page — may ask for them.
     */
    ctx.response.header(
      'permissions-policy',
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
    )

    /**
     * Break the link between this page and any window that opened it, which
     * is what closes the cross-window half of Spectre-style attacks and
     * `window.opener` tampering. Safe here because the one flow that opens a
     * cross-origin window — checkout — is a plain navigation that never
     * talks back to its opener.
     */
    ctx.response.header('cross-origin-opener-policy', 'same-origin')

    /**
     * Adobe's cross-domain policy file is a 2005 problem that still has a
     * 2026 header. One line, and one fewer thing to explain to a scanner.
     */
    ctx.response.header('x-permitted-cross-domain-policies', 'none')

    return next()
  }
}
