import drive from '@adonisjs/drive/services/main'

import type { FileStorage, StorageDisk } from '#storage/contracts'

/**
 * How long a signed URL for a private object stays valid.
 *
 * Short on purpose. A signed URL is a bearer token in a query string: it ends
 * up in browser history, in a referrer header, in a pasted screenshot. Long
 * enough to click and download, short enough that a leaked link is not a
 * standing grant.
 */
export const SIGNED_URL_TTL = '15 minutes'

/**
 * The only class in the codebase that talks to Drive (plan §4).
 */
export class DiskStorage implements FileStorage {
  async moveFromTmp(input: {
    tmpPath: string
    disk: StorageDisk
    key: string
    contentType: string
  }): Promise<void> {
    await drive.use(input.disk).moveFromFs(input.tmpPath, input.key, {
      /**
       * Set explicitly rather than inferred by the driver, because the
       * content type stored on the object is what a browser will act on
       * later. It comes from `FileService`'s own sniffing, never from the
       * request's header (plan §10).
       */
      contentType: input.contentType,
      visibility: input.disk === 'public' ? 'public' : 'private',
    })
  }

  async delete(input: { disk: StorageDisk; key: string }): Promise<void> {
    await drive.use(input.disk).delete(input.key)
  }

  async exists(input: { disk: StorageDisk; key: string }): Promise<boolean> {
    return drive.use(input.disk).exists(input.key)
  }

  async urlFor(input: {
    disk: StorageDisk
    key: string
    expiresIn?: string
    downloadAs?: string
  }): Promise<string> {
    /**
     * A public object has a plain, cacheable URL — signing it would defeat
     * the CDN it exists to be served from.
     */
    if (input.disk === 'public' && !input.downloadAs) {
      return drive.use(input.disk).getUrl(input.key)
    }

    return drive.use(input.disk).getSignedUrl(input.key, {
      expiresIn: input.expiresIn ?? SIGNED_URL_TTL,

      /**
       * Forces a download with the name the customer uploaded, rather than
       * rendering the uuid key we store it under.
       */
      contentDisposition: input.downloadAs
        ? `attachment; filename="${input.downloadAs.replace(/["\\]/g, '')}"`
        : undefined,
    })
  }

  async list(input: { disk: StorageDisk; prefix: string }): Promise<string[]> {
    const disk = drive.use(input.disk)
    const keys: string[] = []

    /**
     * Recursive, because the key convention nests by year and month
     * (`orgs/{org}/{yyyy}/{mm}/…`) and a shallow listing would only ever
     * return directories.
     *
     * Paged through to the end: a bucket answers a listing 1000 keys at a
     * time, so stopping at the first page would make the purge job's
     * reconciliation quietly wrong for any tenant past that.
     */
    let paginationToken: string | undefined

    do {
      const page = await disk.listAll(input.prefix, { recursive: true, paginationToken })

      for (const item of page.objects) {
        if (item.isFile) {
          keys.push(item.key)
        }
      }

      paginationToken = page.paginationToken
    } while (paginationToken)

    return keys
  }
}

export default new DiskStorage()
