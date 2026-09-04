import env from '#start/env'
import { defineConfig, transports } from '@adonisjs/mail'
import type { InferMailers } from '@adonisjs/mail/types'

/**
 * Mail (plan §8).
 *
 * `@adonisjs/mail` already *is* the provider abstraction, so "swappable email
 * provider" is satisfied by adding a transport here — no application code
 * knows which one is active.
 *
 * Locally: `smtp` pointed at Mailpit (`docker run -p 1025:1025 -p 8025:8025
 * axllent/mailpit`, or `brew install mailpit`), so nothing leaves the machine.
 * Deployed: `resend`.
 */
const mailConfig = defineConfig({
  default: env.get('MAIL_MAILER', 'smtp'),

  from: {
    address: env.get('MAIL_FROM_ADDRESS', 'onboarding@resend.dev'),
    name: env.get('MAIL_FROM_NAME', env.get('APP_NAME', 'Acme')),
  },

  /**
   * Shared with every email template.
   */
  globals: {
    appName: env.get('APP_NAME', 'Acme'),
    appUrl: env.get('APP_URL'),
  },

  mailers: {
    smtp: transports.smtp({
      host: env.get('SMTP_HOST', 'localhost'),
      port: env.get('SMTP_PORT', 1025),
    }),

    /**
     * Resend only delivers from a domain verified by DNS (SPF + DKIM). Until
     * that is done the one usable sender is `onboarding@resend.dev`, and it
     * can only reach the account owner's own address — which is why
     * MAIL_FROM_ADDRESS defaults to it rather than to a domain that would
     * silently bounce.
     */
    resend: transports.resend({
      key: env.get('RESEND_API_KEY')?.release() ?? '',
      baseUrl: env.get('RESEND_BASE_URL', 'https://api.resend.com'),
    }),
  },
})

export default mailConfig

declare module '@adonisjs/mail/types' {
  export interface MailersList extends InferMailers<typeof mailConfig> {}
}
