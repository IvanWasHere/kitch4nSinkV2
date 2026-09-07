import paymentsConfig from '#config/payments'
import type { PaymentProvider } from '#billing/contracts'
import { CreemProvider } from '#billing/providers/creem'

/**
 * Resolves the configured payment provider (plan §7.1).
 *
 * The rest of the application depends on the `PaymentProvider` interface and
 * on this function, never on a concrete class — so the day Stripe arrives,
 * the diff is one case here.
 */
let instance: PaymentProvider | null = null

/**
 * A stand-in installed by tests. Kept as a module-level swap rather than a
 * container binding for the same reason the mail fake is: a functional test
 * drives the real HTTP stack, and it must be able to answer for the provider
 * without a network call or a Creem account.
 */
let fake: PaymentProvider | null = null

export function paymentProvider(): PaymentProvider {
  if (fake) {
    return fake
  }

  if (!instance) {
    instance = build()
  }

  return instance
}

function build(): PaymentProvider {
  switch (paymentsConfig.provider) {
    case 'creem':
      return new CreemProvider(paymentsConfig.providers.creem)
    default:
      /**
       * Unreachable while the config enum has one member, and here so that
       * adding a key to `config/payments.ts` without a driver is a compile
       * error rather than a runtime surprise at checkout.
       */
      throw new Error(`No driver for payment provider "${paymentsConfig.provider}"`)
  }
}

/**
 * Install a stand-in provider for the duration of a test.
 */
export function fakePaymentProvider(provider: PaymentProvider): void {
  fake = provider
}

export function restorePaymentProvider(): void {
  fake = null
}
