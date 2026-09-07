import env from '#start/env'

/**
 * Which payment provider is live, and what it needs (plan §7.1).
 *
 * Shaped exactly like `config/mail.ts` picks a transport: a key selects a
 * driver, and adding Stripe is a class in `app/billing/providers/` plus an
 * entry here. Nothing outside that directory reads this file — application
 * code asks `#billing/provider` for *a* `PaymentProvider` and never learns
 * which one it got.
 */
const paymentsConfig = {
  /**
   * Defaults to `creem` so a fresh clone boots. Without an API key the
   * provider still constructs and still verifies webhooks — it only refuses
   * when someone actually tries to charge a card, which is what lets the
   * billing UI be built and tested before an account exists (plan §7.6).
   */
  provider: env.get('PAYMENT_PROVIDER', 'creem'),

  providers: {
    creem: {
      /**
       * `.release()` because these are declared with `Env.schema.secret()`,
       * which hands back a `Secret` wrapper rather than a string so a
       * credential cannot be logged by accident. `createHmac` and a fetch
       * header both need the real value.
       */
      apiKey: env.get('CREEM_API_KEY')?.release() ?? '',

      /**
       * Test mode by default. The live host is a deliberate, visible change
       * in the environment rather than something a `NODE_ENV` flip does
       * quietly.
       */
      apiUrl: env.get('CREEM_API_URL', 'https://test-api.creem.io'),
      webhookSecret: env.get('CREEM_WEBHOOK_SECRET')?.release() ?? '',
    },
  },
} as const

export type PaymentProviderKey = keyof (typeof paymentsConfig)['providers']

export default paymentsConfig
