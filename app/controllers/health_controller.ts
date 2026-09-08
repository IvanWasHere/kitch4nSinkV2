import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'

/**
 * How long a dependency has to answer before it is called unreachable.
 *
 * A readiness probe that hangs is worse than one that fails: the orchestrator
 * waits on it, the deploy stalls, and nothing says why. Two seconds is longer
 * than a healthy round trip to either dependency by an order of magnitude.
 */
const CHECK_TIMEOUT_MS = 2000

/**
 * Liveness and readiness (plan §16).
 *
 * Two endpoints because they answer two different questions, and conflating
 * them causes an outage of its own:
 *
 * - `/health` asks "is this process alive?" and touches **nothing**. It is
 *   what a platform restarts a container on. Wire a database check into it
 *   and a brief database blip becomes every web process being killed at
 *   once, which turns a blip into an outage.
 * - `/ready` asks "can this process serve a request?" and checks the things
 *   a request needs. It is what a load balancer takes an instance out of
 *   rotation on — reversible, and the right response to a dependency that is
 *   briefly gone.
 *
 * Neither says anything a stranger can use: no versions, no hostnames, no
 * error text. The reason a check failed goes to the log, where the operator
 * who can act on it is already looking.
 */
export default class HealthController {
  /**
   * Liveness. No dependencies, no database, no disk.
   */
  async live({ response }: HttpContext) {
    return response.ok({ status: 'ok' })
  }

  /**
   * Readiness: the database this application cannot serve a page without,
   * and the disk it stores uploads on.
   *
   * Both are checked even when the first has already failed, so one probe
   * reports everything that is wrong rather than the first thing.
   */
  async ready({ response }: HttpContext) {
    const [database, storage] = await Promise.all([this.checkDatabase(), this.checkStorage()])

    const ok = database && storage

    return response.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'unavailable',
      checks: {
        database: database ? 'ok' : 'unreachable',
        storage: storage ? 'ok' : 'unreachable',
      },
    })
  }

  /**
   * The cheapest question that proves a connection can be checked out of the
   * pool and used.
   */
  private async checkDatabase(): Promise<boolean> {
    return this.attempt('database', () => db.connection().rawQuery('select 1'))
  }

  /**
   * A metadata read, not a write.
   *
   * On R2 this is a single `HEAD` against a key that does not exist, which
   * answers "are the credentials good and is the bucket there?" without
   * leaving an object behind on every probe — and probes run for the life of
   * the deployment.
   */
  private async checkStorage(): Promise<boolean> {
    return this.attempt('storage', () => drive.use().exists('.health-probe'))
  }

  private async attempt(name: string, check: () => Promise<unknown>): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined

    try {
      await Promise.race([
        check(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${name} check timed out`)), CHECK_TIMEOUT_MS)
        }),
      ])

      return true
    } catch (error) {
      logger.error({ err: error, check: name }, 'readiness check failed')

      return false
    } finally {
      clearTimeout(timer)
    }
  }
}
