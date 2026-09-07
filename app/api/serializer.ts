import { BaseSerializer } from '@adonisjs/core/transformers'

/**
 * Turns transformer output into plain objects (plan §11).
 *
 * `wrap` is undefined and the envelope is built by `#api/responses` instead,
 * so **one file** decides what an API response looks like. Splitting that
 * between a serializer's wrapper and a controller's hand-written `{ data, meta }`
 * is how two endpoints end up shaped differently.
 */
class ApiSerializer extends BaseSerializer<{ Wrap: undefined }> {
  wrap = undefined

  /**
   * Never called: pagination here is cursor-based (`#api/cursor`), not
   * Lucid's page-based paginator, so no transformer produces paginator
   * metadata. Required by the base class.
   */
  definePaginationMetaData() {
    return undefined
  }
}

export default new ApiSerializer()
