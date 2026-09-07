import type { HttpContext } from '@adonisjs/core/http'

import plans from '#billing/plan_service'
import files, { MAX_FILE_BYTES } from '#storage/file_service'
import File from '#models/file'
import { UploadRejectedError } from '#storage/contracts'
import { ALLOWED_EXTENSIONS } from '#storage/keys'

/**
 * The Files screen (plan §13.5).
 *
 * The mockup's product grid, re-cut as file cards. Every member can upload;
 * the storage quota is enforced in `FileService`, inside the transaction that
 * records the file (plan §10).
 */
export default class FileController {
  async index({ view, organization, bouncer }: HttpContext) {
    await bouncer.with('FilePolicy').authorize('viewAny', organization)

    const stored = await files.forOrganization(organization)

    return view.render('pages/files/index', {
      files: stored,
      /**
       * Rendered as a hint under the drop zone, so the rules are visible
       * before somebody picks a 40 MB video.
       */
      accept: ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(','),
      maxFileSize: File.formatBytes(MAX_FILE_BYTES),
      storage: plans.storageUsage(organization),
    })
  }

  async store({ request, response, session, auth, organization, bouncer }: HttpContext) {
    await bouncer.with('FilePolicy').authorize('create', organization)

    const upload = request.file('file')

    if (!upload || !upload.tmpPath) {
      session.flash('error', 'Choose a file to upload.')
      return response.redirect().toRoute('files.index')
    }

    try {
      const file = await files.upload(organization, auth.use('web').user!, {
        tmpPath: upload.tmpPath,
        clientName: upload.clientName,
        sizeBytes: upload.size,
      })

      session.flash('success', `${file.originalName} uploaded.`)
    } catch (error) {
      /**
       * A rejected upload is a message about the file, not a failure of the
       * page — the quota case throws `PlanLimitExceededException` instead and
       * is rendered by the exception handler with the upsell (plan §7.4).
       */
      if (error instanceof UploadRejectedError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('files.index')
      }

      throw error
    }

    return response.redirect().toRoute('files.index')
  }

  /**
   * Hand the browser a URL for the bytes.
   *
   * A redirect rather than streaming through the application: the object
   * lives in a bucket, and proxying it would put every download through our
   * bandwidth and our event loop. Private files get a short-lived signed URL,
   * so the redirect target is not a standing grant (plan §10).
   */
  async show({ params, response, session, organization, request, bouncer }: HttpContext) {
    const file = await files.find(organization, params.id)

    if (!file) {
      session.flash('error', 'That file no longer exists.')
      return response.redirect().toRoute('files.index')
    }

    await bouncer.with('FilePolicy').authorize('view', file)

    const url = await files.urlFor(file, { download: request.input('download') === '1' })

    /**
     * `clearQs()` because `config/app.ts` forwards the request's query string
     * onto every redirect. Appended after a signed URL's own query string
     * that produces `…&signature=…?download=1`, which is not the string that
     * was signed — so the download 401s.
     */
    return response.redirect().clearQs().toPath(url)
  }

  async destroy({ params, response, session, organization, bouncer }: HttpContext) {
    const file = await files.find(organization, params.id)

    if (!file) {
      session.flash('error', 'That file no longer exists.')
      return response.redirect().toRoute('files.index')
    }

    await bouncer.with('FilePolicy').authorize('delete', file)
    await files.delete(file)

    session.flash(
      'success',
      `${file.originalName} deleted. It is recoverable for 30 days — ask support if you need it back.`
    )

    return response.redirect().toRoute('files.index')
  }
}
