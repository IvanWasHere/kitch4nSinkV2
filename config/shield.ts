import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/shield'

import env from '#start/env'

/**
 * Security configuration using Shield.
 * Provides protection against common web vulnerabilities like CSRF,
 * XSS, clickjacking, and other security threats.
 */

/**
 * The origin of a URL, or nothing when it was never configured.
 *
 * Object storage is addressed by two different hosts depending on how a file
 * is served — the public custom domain for logos, the signing endpoint for
 * everything private (§10) — and both have to be named in `img-src` or the
 * avatars quietly stop rendering. Deriving them from the same variables the
 * disks are built from means one place to change when a bucket moves.
 */
function originOf(url: string | undefined): string[] {
  if (!url) {
    return []
  }

  try {
    return [new URL(url).origin]
  } catch {
    return []
  }
}

/**
 * Where Vite serves modules and its HMR socket when the assets have not been
 * built.
 *
 * Vite chooses its own ports — one for the module server, another for the
 * HMR socket — and neither is knowable from here, so the port is wildcarded
 * and the host is not.
 *
 * Keyed on "not production" rather than "development" deliberately: the test
 * environment also serves assets through Vite, and a policy that forgot that
 * makes every browser test fail on a console error rather than on anything a
 * user would see. In production the assets are files under `/assets`, and
 * `'self'` covers them.
 */
const viteServing = app.inProduction ? [] : ['http://localhost:*', 'http://127.0.0.1:*']
const viteSocket = app.inProduction ? [] : ['ws://localhost:*', 'ws://127.0.0.1:*']

const storageOrigins = [...originOf(env.get('R2_PUBLIC_URL')), ...originOf(env.get('R2_ENDPOINT'))]

const shieldConfig = defineConfig({
  /**
   * Content Security Policy (plan §16, M8).
   *
   * The policy this application can actually hold, rather than the one that
   * looks strictest in a screenshot. Three of these entries are compromises,
   * and each says what it costs and how to remove it.
   *
   * What it buys: an injected `<script>` — the payload of essentially every
   * stored-XSS bug — does not run, because it carries no nonce. That is the
   * failure this is here to survive.
   */
  csp: {
    enabled: true,

    directives: {
      defaultSrc: [`'self'`],

      /**
       * Scripts: our own bundle, plus a per-response nonce for the two
       * places that must be inline (`@vite` in development, the docs
       * bootstrap). `@nonce` is substituted by Shield and exposed to Edge as
       * `cspNonce` — an inline script without it will not run, which is the
       * whole point and also the first thing to check when one silently
       * stops working.
       *
       * `'unsafe-eval'` is Alpine. Alpine compiles the expressions in
       * `x-show`, `x-text` and friends with `new Function`, so the standard
       * build cannot run without it. It is a narrower hole than it sounds:
       * it lets *already-trusted* code evaluate strings, it does not let an
       * attacker introduce code, and the nonce rule above still refuses the
       * injected `<script>` that would be needed to reach it. Removing it
       * means moving to `@alpinejs/csp` and rewriting every inline
       * expression as a method or getter on an `Alpine.data` component —
       * worth doing if this application ever handles user-authored HTML.
       *
       * jsDelivr serves the Scalar viewer on `/docs`, and nothing else.
       * Delete both the entry and that `<script>` if you would rather bundle
       * it or drop the page.
       */
      scriptSrc: [`'self'`, '@nonce', `'unsafe-eval'`, 'https://cdn.jsdelivr.net', ...viteServing],

      /**
       * `'unsafe-inline'` for styles, deliberately.
       *
       * Roughly thirty layout one-offs in the templates are `style="…"`
       * attributes, the usage meters compute a width from a percentage, and
       * Vite injects a `<style>` element per module while developing.
       * Style injection on its own executes nothing — the historic escapes
       * from it, `expression()` and friends, are long dead — so this buys a
       * policy that is simple and honest over one that would need a nonce
       * threaded through every component to protect against considerably
       * less.
       */
      styleSrc: [`'self'`, `'unsafe-inline'`, ...viteServing],

      /**
       * `data:` for the two-factor QR code, `blob:` for the preview an
       * upload shows before it has been sent anywhere, and the object
       * storage origins because that is where avatars and logos come from.
       */
      imgSrc: [`'self'`, 'data:', 'blob:', ...storageOrigins],
      fontSrc: [`'self'`, 'data:', 'https://cdn.jsdelivr.net'],

      /**
       * XHR and the Vite HMR socket. Uploads go to this application, so
       * `'self'` is the whole list in production.
       */
      connectSrc: [`'self'`, ...viteServing, ...viteSocket],

      /**
       * Nothing is embedded and nothing embeds us. `frameAncestors` is the
       * modern half of the `X-Frame-Options` header configured below; both
       * are sent, because the old header is what an old browser understands.
       */
      frameSrc: [`'none'`],
      frameAncestors: [`'none'`],
      objectSrc: [`'none'`],

      /**
       * `base-uri` is the one people forget: without it, an injected
       * `<base href="https://evil.example">` re-points every relative script
       * and form on the page, and a nonce policy does not notice.
       *
       * `form-action` is `'self'` plus any HTTPS destination, and the
       * "plus" is not laziness. Checkout is a form POST to this application
       * that answers with a redirect to the payment provider, and browsers
       * apply `form-action` **across that redirect** — with `'self'` alone
       * the upgrade button silently does nothing and the only trace is a
       * console message naming our own URL. The provider's checkout host is
       * only known at runtime, from the session it just created, so it
       * cannot be listed here.
       *
       * What remains blocked is what matters most: `javascript:`, `data:`
       * and plain-HTTP form targets. If you know your provider's checkout
       * and portal hostnames, replacing `https:` with them is a one-line
       * tightening.
       */
      baseUri: [`'self'`],
      formAction: [`'self'`, 'https:'],

      /**
       * Only in production: on a laptop the application is served over
       * plain HTTP and upgrading every request would break it.
       */
      ...(app.inProduction ? { upgradeInsecureRequests: [] } : {}),
    },

    /**
     * Report-only is for the hour after you tighten one of the directives
     * above on a live site: violations are reported and nothing is blocked,
     * so a mistake shows up in the browser console instead of in support.
     * Off by default — a policy nobody enforces protects nobody.
     */
    reportOnly: env.get('CSP_REPORT_ONLY', false),
  },

  /**
   * Configure CSRF protection options. Refer documentation
   * to learn more
   */
  csrf: {
    /**
     * Enable CSRF protection.
     * Protects against Cross-Site Request Forgery attacks.
     */
    enabled: true,

    /**
     * Routes that should be excluded from CSRF protection.
     *
     * Payment webhooks have no session and no form: their authentication is
     * an HMAC signature over the raw body, checked in the controller
     * (plan §7.5). A CSRF token would be meaningless to the provider and
     * would reject every delivery.
     *
     * The organisation API is exempt for the same reason: it is
     * authenticated by a bearer token, has no session and no cookie, so
     * there is no cross-site request to forge — and a token-authenticated
     * client has no way to obtain a CSRF token anyway.
     *
     * A predicate rather than a list of patterns, because the array form is
     * an **exact** match on `route.pattern` — `'/webhooks/*'` there silently
     * matches nothing, and the failure looks like a provider signing its
     * requests wrong rather than a config typo. This also means a new
     * endpoint under either prefix is exempt the moment it is added.
     */
    exceptRoutes: (ctx) => {
      const pattern = ctx.route?.pattern ?? ''

      return pattern.startsWith('/webhooks/') || pattern.startsWith('/api/')
    },

    /**
     * Enable XSRF-TOKEN cookie for JavaScript frameworks.
     * When enabled, the CSRF token is available to client-side code.
     */
    enableXsrfCookie: false,

    /**
     * HTTP methods that require CSRF token validation.
     * GET, HEAD, and OPTIONS are safe methods and don't need protection.
     */
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  },

  /**
   * Control how your website should be embedded inside
   * iFrames
   */
  xFrame: {
    /**
     * Enable X-Frame-Options header.
     * Helps prevent clickjacking attacks.
     */
    enabled: true,

    /**
     * Frame embedding policy.
     * It can block all framing with 'DENY' or allow same-origin framing
     * with 'SAMEORIGIN'.
     */
    action: 'DENY',
  },

  /**
   * Force browser to always use HTTPS
   */
  hsts: {
    /**
     * Enable HTTP Strict Transport Security.
     * Tells browsers to always use HTTPS for this site.
     */
    enabled: true,

    /**
     * How long browsers should remember to use HTTPS.
     * After this period, browsers may try HTTP again.
     */
    maxAge: '180 days',
  },

  /**
   * Disable browsers from sniffing the content type of a
   * response and always rely on the "content-type" header.
   */
  contentTypeSniffing: {
    /**
     * Enable X-Content-Type-Options: nosniff header.
     * Prevents MIME type sniffing which can lead to security vulnerabilities.
     */
    enabled: true,
  },
})

export default shieldConfig
