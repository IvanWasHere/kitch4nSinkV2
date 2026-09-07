import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'

import ApiKey from '#models/api_key'
import type User from '#models/user'
import Organization from '#models/organization'
import plans from '#billing/plan_service'
import { generateApiKey, hashApiKey, type ApiKeyEnvironment } from '#api/keys'
import { DEFAULT_SCOPES, normalizeScopes } from '#api/scopes'

export class ApiKeyError extends Error {
  constructor(
    message: string,
    readonly reason: 'no_scopes' | 'duplicate_name'
  ) {
    super(message)
  }
}

export interface CreatedKey {
  apiKey: ApiKey

  /**
   * The one moment the secret exists. The caller shows it once; nothing
   * stores it.
   */
  secret: string
}

/**
 * Creating, listing and revoking API keys (plan §11).
 *
 * Owner-only, enforced by the route group and by `ApiKeyPolicy` — a key is
 * billing-adjacent, since it can consume the organisation's whole monthly
 * call quota.
 */
export class ApiKeyService {
  /**
   * Mint a key.
   *
   * The `apiKeys` quota is checked under a lock on the organisation row, the
   * same way every other count limit is (plan §7.4) — and it is the limit
   * where `0` genuinely means "not on this plan", so the Free tier gets a
   * `402` rather than an empty screen.
   */
  async create(
    organization: Organization,
    actor: User,
    input: {
      name: string
      scopes?: unknown
      environment?: ApiKeyEnvironment
      expiresAt?: DateTime | null
    }
  ): Promise<CreatedKey> {
    const scopes = input.scopes === undefined ? DEFAULT_SCOPES : normalizeScopes(input.scopes)

    if (scopes.length === 0) {
      throw new ApiKeyError('Choose at least one thing this key may do.', 'no_scopes')
    }

    const generated = generateApiKey(input.environment ?? 'live')

    const apiKey = await db.transaction(async (trx) => {
      await plans.lockAndAssertLimit(trx, organization, 'apiKeys', (client) =>
        this.activeCount(organization, client)
      )

      return ApiKey.create(
        {
          organizationId: organization.id,
          name: input.name.trim(),
          prefix: generated.prefix,
          keyHash: generated.hash,
          scopes,
          expiresAt: input.expiresAt ?? null,
          createdByUserId: actor.id,
        },
        { client: trx }
      )
    })

    return { apiKey, secret: generated.secret }
  }

  /**
   * Keys a customer can see. Revoked ones are kept — the record of what a
   * compromised key did outlives the key — but they are not listed.
   */
  async forOrganization(organization: Organization): Promise<ApiKey[]> {
    return ApiKey.query()
      .where('organization_id', organization.id)
      .whereNull('revoked_at')
      .preload('createdBy')
      .orderBy('created_at', 'desc')
  }

  async find(organization: Organization, publicId: string): Promise<ApiKey | null> {
    return ApiKey.query()
      .where('public_id', publicId)
      .where('organization_id', organization.id)
      .whereNull('revoked_at')
      .first()
  }

  /**
   * Revoke immediately.
   *
   * The row stays: `api_requests` references it, and "what did this key touch
   * before we noticed" is the first question after a leak. The next
   * authenticated request with it fails on `revoked_at`.
   */
  async revoke(apiKey: ApiKey): Promise<void> {
    apiKey.revokedAt = DateTime.utc()
    await apiKey.save()
  }

  /**
   * How many keys count against the plan's `apiKeys` limit.
   *
   * Revoked keys do not: revoking is how a customer frees a slot, and a
   * ceiling that counted retired keys would fill up permanently.
   */
  async activeCount(organization: Organization, trx?: TransactionClientContract): Promise<number> {
    const [row] = await ApiKey.query(trx ? { client: trx } : {})
      .where('organization_id', organization.id)
      .whereNull('revoked_at')
      .count('* as total')

    return Number(row.$extras.total)
  }

  /**
   * Authenticate a presented key.
   *
   * Looked up by hash, so the plaintext never has to be compared against
   * anything, and a key we have never seen costs exactly one indexed lookup.
   * Returns null for every failure — revoked, expired, unknown — because the
   * caller must not be able to tell those apart.
   */
  async authenticate(
    secret: string
  ): Promise<{ apiKey: ApiKey; organization: Organization } | null> {
    const apiKey = await ApiKey.query().where('key_hash', hashApiKey(secret)).first()

    if (!apiKey || !apiKey.isActive) {
      return null
    }

    const organization = await Organization.query()
      .where('id', apiKey.organizationId)
      .whereNull('deleted_at')
      .first()

    if (!organization || organization.isSuspended) {
      return null
    }

    return { apiKey, organization }
  }

  /**
   * Note that a key was used, at most once a minute.
   *
   * `last_used_at` is what tells a customer which key is safe to revoke, so
   * it has to be maintained — but a write per request would double the
   * database traffic of the whole API for a column nobody reads in real time
   * (plan §11).
   */
  async touch(apiKey: ApiKey): Promise<void> {
    const now = DateTime.utc()

    if (apiKey.lastUsedAt && now.diff(apiKey.lastUsedAt, 'seconds').seconds < 60) {
      return
    }

    apiKey.lastUsedAt = now
    await apiKey.save()
  }
}

export default new ApiKeyService()
