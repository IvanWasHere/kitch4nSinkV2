import env from '#start/env'
import { defineConfig, services } from '@adonisjs/ally'
import type { InferSocialProviders } from '@adonisjs/ally/types'

/**
 * Social sign-in (plan M1).
 *
 * Credentials are optional: a fresh clone runs with none, and the sign-in
 * screen simply does not offer the buttons. `socialProviders` below is what
 * the controllers and templates read, so a provider is never offered unless
 * it can actually complete a round trip.
 */
const allyConfig = defineConfig({
  google: services.google({
    clientId: env.get('GOOGLE_CLIENT_ID', ''),
    clientSecret: env.get('GOOGLE_CLIENT_SECRET')?.release() ?? '',
    callbackUrl: `${env.get('APP_URL')}/auth/google/callback`,
  }),
  github: services.github({
    clientId: env.get('GITHUB_CLIENT_ID', ''),
    clientSecret: env.get('GITHUB_CLIENT_SECRET')?.release() ?? '',
    callbackUrl: `${env.get('APP_URL')}/auth/github/callback`,
  }),
})

export default allyConfig

/**
 * The providers this deployment is configured for, in the order they should
 * be offered.
 */
export const socialProviders = [
  { name: 'google' as const, label: 'Google', configured: !!env.get('GOOGLE_CLIENT_ID') },
  { name: 'github' as const, label: 'GitHub', configured: !!env.get('GITHUB_CLIENT_ID') },
]

export const enabledSocialProviders = socialProviders.filter((provider) => provider.configured)

export type SocialProviderName = (typeof socialProviders)[number]['name']

declare module '@adonisjs/ally/types' {
  interface SocialProviders extends InferSocialProviders<typeof allyConfig> {}
}
