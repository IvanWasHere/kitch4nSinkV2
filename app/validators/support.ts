import vine from '@vinejs/vine'

/**
 * Opening a ticket and replying to one (plan §21.8).
 *
 * The caps are generous for a person and useless for a script; the rate
 * limiter in `start/limiter.ts` handles the script.
 */
export const openTicketValidator = vine.create({
  subject: vine.string().trim().minLength(3).maxLength(150),
  body: vine.string().trim().minLength(1).maxLength(5000),
})

export const replyValidator = vine.create({
  body: vine.string().trim().minLength(1).maxLength(5000),
})
