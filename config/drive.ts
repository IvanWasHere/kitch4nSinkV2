import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, services } from '@adonisjs/drive'

/**
 * File storage (plan §10).
 *
 * Two things are being chosen here, and keeping them separate is the whole
 * design:
 *
 * - **Which disk** a file lives on is a *purpose*: `private` (everything, by
 *   default) or `public` (avatars and logos, served straight from a CDN).
 *   Application code names one of these two and nothing else.
 * - **What backs a disk** is an environment concern: the local filesystem on
 *   a laptop, Cloudflare R2 when deployed, chosen by `DRIVE_DISK`.
 *
 * So moving to R2 is one variable, and `files.disk` keeps recording which
 * purpose a row belongs to rather than which vendor held it — which is what
 * makes a provider migration a backfill instead of a rewrite.
 *
 * Called `config/drive.ts` rather than plan §4's `config/storage.ts` because
 * the Drive provider reads that exact key from the config tree; the file's
 * job is unchanged.
 */
const usingR2 = env.get('DRIVE_DISK', 'fs') === 'r2'

/**
 * R2 speaks S3. `region: 'auto'` is R2's own requirement, and the endpoint is
 * account-scoped (`https://<account_id>.r2.cloudflarestorage.com`).
 */
const r2 = (visibility: 'public' | 'private') =>
  services.s3({
    credentials: {
      accessKeyId: env.get('R2_ACCESS_KEY_ID', ''),
      secretAccessKey: env.get('R2_SECRET_ACCESS_KEY')?.release() ?? '',
    },
    region: 'auto',
    bucket: env.get('R2_BUCKET', ''),
    endpoint: env.get('R2_ENDPOINT'),
    visibility,

    /**
     * Only the public disk gets a URL builder, and only when a custom domain
     * is configured. A bucket's own endpoint is not publicly readable, so
     * handing one out would produce links that 401 for every visitor.
     */
    urlBuilder:
      visibility === 'public' && env.get('R2_PUBLIC_URL')
        ? { generateURL: async (key) => `${env.get('R2_PUBLIC_URL')!.replace(/\/$/, '')}/${key}` }
        : undefined,
  })

/**
 * Locally both disks are directories under `storage/`, served by Drive's own
 * file route. The private one still requires a signature there, so the local
 * and deployed access rules are the same rules — a private file that is
 * readable on a laptop and not in production is a bug found by a customer.
 */
const local = (visibility: 'public' | 'private', folder: string) =>
  services.fs({
    /**
     * `DRIVE_FS_ROOT` exists so the test suite can write somewhere
     * disposable. Uploads are the one thing a test leaves on disk, and a
     * suite that scatters them through the directory a developer is working
     * in is a suite people stop running.
     */
    location: app.makePath(env.get('DRIVE_FS_ROOT', 'storage'), folder),
    serveFiles: true,
    routeBasePath: `/uploads/${folder}`,
    visibility,
    appUrl: env.get('APP_URL'),
  })

const driveConfig = defineConfig({
  default: 'private',

  services: {
    private: usingR2 ? r2('private') : local('private', 'private'),
    public: usingR2 ? r2('public') : local('public', 'public'),
  },
})

export default driveConfig

declare module '@adonisjs/drive/types' {
  export interface DriveDisks extends InferDriveDisks<typeof driveConfig> {}
}
