import logger from '@adonisjs/core/services/logger'

import RegistrationClosedException from '#exceptions/registration_closed_exception'

type Resolver = () => boolean | Promise<boolean>

/**
 * Whether a new account may be created (plan §22.2, D10).
 *
 * Core asks; a feature answers. Registration Control registers the resolver
 * that reads its runtime setting, and with nothing registered the answer is
 * **open** — so removing that module reopens signup rather than leaving it
 * closed behind a switch nobody can reach any more.
 *
 * Landing reads this too, to decide which call to action to show. That is the
 * whole reason it lives in core: a module asking another module "is signup
 * open?" would be the cross-module import the modularity suite forbids.
 *
 * One slot, not a list. Two features both deciding who may register would
 * need a rule for when they disagree, and nothing has asked for one.
 */
export class RegistrationGate {
  #resolver: Resolver | null = null

  /**
   * Hand the gate its answer. `null` puts it back to the default, open.
   */
  decideWith(resolver: Resolver | null): this {
    this.#resolver = resolver
    return this
  }

  /**
   * Whatever is deciding right now — so a test can close the gate by hand
   * and put back the resolver a module registered at boot, rather than
   * leaving every later test with no resolver at all.
   */
  current(): Resolver | null {
    return this.#resolver
  }

  async isOpen(): Promise<boolean> {
    return this.#resolver ? Boolean(await this.#resolver()) : true
  }

  /**
   * The check every account-creating path makes. Throws rather than returns
   * so a path that forgets to look at the answer cannot carry on regardless.
   */
  async assertOpen(context: { via: 'signup' | 'social' }): Promise<void> {
    if (await this.isOpen()) {
      return
    }

    logger.info({ event: 'registration.blocked', via: context.via }, 'registration is closed')
    throw new RegistrationClosedException()
  }
}

export default new RegistrationGate()
