import type { HttpContext } from '@adonisjs/core/http'

import files from '#storage/file_service'
import { profileValidator } from '#validators/auth'
import { UploadRejectedError } from '#storage/contracts'

/**
 * Settings is split across three routes rather than three cards on one page
 * (plan §13.6.4), so permissions map onto URLs. This one is always the user's
 * own profile.
 */
export default class ProfileController {
  async edit({ view }: HttpContext) {
    return view.render('pages/settings/profile')
  }

  async update({ request, response, session, auth }: HttpContext) {
    const user = auth.use('web').user!
    const { fullName } = await request.validateUsing(profileValidator)

    user.fullName = fullName
    await user.save()

    session.flash('success', 'Your profile has been updated.')
    return response.redirect().toRoute('settings.profile')
  }

  /**
   * An avatar goes on the **public** disk, because it is rendered in the
   * application shell on every page — a signed URL there would expire while
   * somebody was reading, and re-signing it per request would put a bucket
   * call in front of every page load (plan §10).
   *
   * `users.avatar_key` stores the key, never a URL, so moving providers stays
   * a config change.
   */
  async updateAvatar({ request, response, session, auth, organization }: HttpContext) {
    const user = auth.use('web').user!
    const upload = request.file('avatar')

    if (!upload || !upload.tmpPath) {
      session.flash('error', 'Choose an image to upload.')
      return response.redirect().toRoute('settings.profile')
    }

    try {
      const file = await files.replaceAttachment(organization, user, {
        tmpPath: upload.tmpPath,
        clientName: upload.clientName,
        sizeBytes: upload.size,
        attachTo: { type: 'User', id: user.id },
      })

      if (!file.isImage) {
        throw new UploadRejectedError('An avatar has to be an image.', 'extension_not_allowed')
      }

      user.avatarKey = file.key
      await user.save()

      session.flash('success', 'Your picture has been updated.')
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        session.flash('error', error.message)
        return response.redirect().toRoute('settings.profile')
      }

      throw error
    }

    return response.redirect().toRoute('settings.profile')
  }
}
