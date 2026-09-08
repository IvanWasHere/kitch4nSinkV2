import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/core/http'

/**
 * The app URL can be used in various places where you want to create absolute
 * URLs to your application. For example, when sending emails, images should
 * use absolute URLs.
 */
export const appUrl = env.get('APP_URL')

/**
 * The configuration settings used by the HTTP server
 */
export const http = defineConfig({
  /**
   * Generate a unique request ID for each incoming HTTP request.
   * Useful for request tracing and debugging in logs.
   */
  generateRequestId: true,

  /**
   * Allow method spoofing via _method query parameter or form field.
   * Enables using PUT, PATCH, DELETE methods in HTML forms by spoofing
   * through POST requests with _method field.
   */
  allowMethodSpoofing: true,

  /**
   * Enabling async local storage will let you access HTTP context
   * from anywhere inside your application.
   */
  useAsyncLocalStorage: false,

  /**
   * Whether `X-Forwarded-For` is believed (plan §16, M8).
   *
   * This one setting decides what `request.ip()` returns, and therefore what
   * every rate limit in `start/limiter.ts` counts against, what the audit log
   * records as the address an action came from, and which addresses
   * `ADMIN_IP_ALLOWLIST` compares. Both ways of getting it wrong are quiet:
   *
   * - **Off, behind a proxy**: every request appears to come from the load
   *   balancer. All of your customers share one rate-limit bucket, the audit
   *   trail records one address forever, and the allowlist matches either
   *   everybody or nobody.
   * - **On, with nothing in front**: the header is whatever the client typed.
   *   Rate limits are evaded by changing it on every request, and the audit
   *   trail records fiction.
   *
   * So it is off unless you say otherwise, and you should say otherwise
   * exactly when something you control sits in front of this process.
   *
   * Turned on, it trusts **one** hop: the peer that connected to us, and
   * therefore the last address that peer recorded. That is the safe reading
   * of a header a client can also send — extra entries a client appends sit
   * further along the chain and are ignored, so this holds whether your proxy
   * overwrites `X-Forwarded-For` or appends to it.
   *
   * With two proxies in front — a CDN in front of a load balancer — that is
   * one hop short and `request.ip()` becomes the load balancer's address.
   * `distance <= 1` is the change, and it must match your topology exactly:
   * every hop you trust beyond the real ones is a hop a client can forge.
   */
  trustProxy: (_address, distance) => env.get('TRUST_PROXY', false) && distance === 0,

  /**
   * Redirect configuration controls the behavior of
   * response.redirect().back() and query string forwarding.
   */
  redirect: {
    /**
     * When enabled, all redirects automatically carry over the current
     * request's query string parameters to the redirect destination.
     *
     * Useful for a redirect back to one of our own screens — a filter or a
     * page number survives the round trip. **Dangerous for a redirect to an
     * absolute URL somebody else built**: the forwarded parameters are
     * appended after that URL's own query string, which turns a signed
     * storage URL or a provider's checkout link into a 401.
     *
     * Every redirect that leaves the application therefore calls
     * `.clearQs()` first — the signed-URL and checkout paths in
     * `FileController` and `BillingController`.
     */
    forwardQueryString: true,
  },

  /**
   * Manage cookies configuration. The settings for the session id cookie are
   * defined inside the "config/session.ts" file.
   */
  cookie: {
    /**
     * The domain for which the cookie is valid.
     * Empty string means the cookie is valid for the current domain only.
     */
    domain: '',

    /**
     * The path for which the cookie is valid.
     * The cookie is accessible for all routes when the value is '/'.
     */
    path: '/',

    /**
     * Maximum age of the cookie.
     * After this time, the cookie will expire.
     */
    maxAge: '2h',

    /**
     * When true, the cookie is only accessible via HTTP(S) and not
     * by client-side JavaScript, helping prevent XSS attacks.
     */
    httpOnly: true,

    /**
     * When true, the cookie is only sent over HTTPS connections.
     * Enabled in production for security.
     */
    secure: app.inProduction,

    /**
     * Controls when cookies are sent with cross-site requests.
     * This setting provides reasonable security while allowing some cross-site
     * usage (value: 'lax').
     */
    sameSite: 'lax',
  },
})
