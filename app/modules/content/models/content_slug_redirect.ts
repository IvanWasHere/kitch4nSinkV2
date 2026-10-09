import { ContentSlugRedirectSchema } from '#database/schema'

/**
 * A slug a published entry used to have, kept so old links still land
 * (plan §22.6).
 */
export default class ContentSlugRedirect extends ContentSlugRedirectSchema {}
