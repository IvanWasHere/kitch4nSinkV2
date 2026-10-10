import type { DateTime } from 'luxon'

import db from '@adonisjs/lucid/services/db'

import File from '#models/file'
import ApiKey from '#models/api_key'
import AuditLog from '#models/audit_log'
import Invitation from '#models/invitation'
import Organization from '#models/organization'
import SocialAccount from '#models/social_account'
import SupportTicket from '#models/support_ticket'
import type User from '#models/user'
import storage from '#storage/disk_storage'
import type { PrivacyContributor, PrivacyEraseContext } from '#privacy/registry'

/**
 * Core's share of a person's data (plan §22.8.3) — the tables core owns.
 * Features register their own beside these, in `start/privacy.ts`.
 *
 * Every export below lists its fields by hand. That is the point: a column
 * added to `users` next year is not exported until somebody decides it
 * should be, so a new secret can never leak into an archive by default.
 */

const iso = (value: DateTime | null | undefined) => (value ? value.toISO() : null)

export const accountContributor: PrivacyContributor = {
  key: 'account',
  describes: 'Your profile: name, email, role, and when you joined, verified and last signed in.',
  excludes:
    'Your password, two-factor secret and recovery codes — they are stored only as hashes or encrypted, and are credentials, not information about you.',
  covers: [],

  async export(user: User) {
    return {
      id: user.publicId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      emailVerifiedAt: iso(user.emailVerifiedAt),
      twoFactorEnabled: Boolean(user.twoFactorConfirmedAt),
      lastLoginAt: iso(user.lastLoginAt),
      notificationsSeenAt: iso(user.notificationsSeenAt),
      createdAt: iso(user.createdAt),
    }
  },
}

export const workspaceContributor: PrivacyContributor = {
  key: 'workspace',
  describes: 'The workspace you belong to, and its plan if you own it.',
  excludes: "Other members' details — they are theirs to request.",
  covers: ['organizations.owner_id', 'users.organization_id'],

  async export(user: User) {
    const organization = await Organization.find(user.organizationId)

    if (!organization) {
      return null
    }

    const owner = organization.ownerId === user.id

    return {
      id: organization.publicId,
      name: organization.name,
      yourRole: user.role,
      youOwnIt: owner,
      ...(owner ? { plan: organization.planKey, status: organization.status } : {}),
      createdAt: iso(organization.createdAt),
    }
  },
}

export const socialAccountsContributor: PrivacyContributor = {
  key: 'connectedAccounts',
  describes: 'Google or GitHub accounts linked for sign-in.',
  excludes: 'The access tokens those providers issued — they are credentials.',
  covers: ['social_accounts.user_id', 'social_accounts.provider_user_id'],

  async export(user: User) {
    const accounts = await SocialAccount.query().where('user_id', user.id).orderBy('id')

    return accounts.map((account) => ({
      provider: account.provider,
      providerAccountId: account.providerUserId,
      email: account.providerEmail,
      linkedAt: iso(account.createdAt),
    }))
  },

  /**
   * Deleted: a link to a Google or GitHub identity is pure credential, and
   * leaving it would let that identity sign in to the overwritten account.
   */
  async erase(user: User, { trx }: PrivacyEraseContext) {
    await SocialAccount.query({ client: trx }).where('user_id', user.id).delete()
  },
}

export const authTokensContributor: PrivacyContributor = {
  key: 'authTokens',
  describes: 'Not exported.',
  excludes:
    'Email-verification and password-reset tokens. They are short-lived credentials, stored only as hashes.',
  covers: ['auth_tokens.user_id'],

  async export() {
    return null
  },

  async erase(user: User, { trx }: PrivacyEraseContext) {
    await db.from('auth_tokens').useTransaction(trx).where('user_id', user.id).delete()
  },
}

export const filesContributor: PrivacyContributor = {
  key: 'files',
  describes:
    'Every file you uploaded that has not been deleted, with its name, type, size and date. The files themselves are in the files/ folder.',
  covers: ['files.user_id'],

  async export(user: User) {
    const files = await uploadsOf(user)

    return files.map((file) => ({
      id: file.publicId,
      name: file.originalName,
      type: file.mimeType,
      sizeBytes: file.sizeBytes,
      inArchiveAs: `files/${archiveName(file)}`,
      uploadedAt: iso(file.createdAt),
    }))
  },

  async files(user: User) {
    const files = await uploadsOf(user)

    return files.map((file) => ({
      path: archiveName(file),
      disk: file.disk as 'private' | 'public',
      key: file.key,
    }))
  },

  /**
   * The avatar always goes: it is the person's face, not the workspace's
   * work. Everything else they uploaded stays with the workspace — unless
   * they were its last member, when every file in it goes, the way its lists
   * and todos do (plan §22.8.4).
   *
   * Rows are hard-deleted inside the transaction; the stored objects only
   * after it commits.
   */
  async erase(user: User, { trx, lastMember, afterCommit }: PrivacyEraseContext) {
    const doomed = await File.query({ client: trx }).where((query) => {
      query.where((avatar) =>
        avatar.where('attachable_type', 'User').where('attachable_id', user.id)
      )

      if (lastMember) {
        query.orWhere('organization_id', user.organizationId)
      }
    })

    if (!doomed.length) {
      return
    }

    const freed = doomed
      .filter((file) => !file.deletedAt)
      .reduce((sum, file) => sum + file.sizeBytes, 0)

    await File.query({ client: trx })
      .whereIn(
        'id',
        doomed.map((file) => file.id)
      )
      .delete()

    if (freed > 0) {
      await Organization.query({ client: trx })
        .where('id', user.organizationId)
        .decrement('storage_used_bytes', freed)
    }

    /**
     * The workspace logo was among the files when this was its last member;
     * the column pointing at it goes too.
     */
    if (lastMember) {
      await Organization.query({ client: trx })
        .where('id', user.organizationId)
        .update({ logo_key: null })
    }

    afterCommit(async () => {
      for (const file of doomed) {
        await storage
          .delete({ disk: file.disk as 'private' | 'public', key: file.key })
          .catch(() => {})
      }
    })
  },
}

/**
 * Uploads not yet deleted. A soft-deleted file is on its way to being
 * purged, and is no longer something the person has.
 */
function uploadsOf(user: User) {
  return File.query().where('user_id', user.id).whereNull('deleted_at').orderBy('id')
}

/**
 * The public id keeps two uploads called `notes.pdf` apart; the original name
 * keeps the archive readable.
 */
function archiveName(file: File) {
  const safe = [...file.originalName]
    .map((character) =>
      character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character
    )
    .join('')
    .slice(0, 120)
  return `${file.publicId}-${safe}`
}

export const invitationsContributor: PrivacyContributor = {
  key: 'invitationsSent',
  describes: 'Invitations you sent: the role offered, and when each was sent, accepted or revoked.',
  excludes: "The invited people's email addresses — they are somebody else's data.",
  covers: ['invitations.invited_by_user_id'],

  async export(user: User) {
    const invitations = await Invitation.query().where('invited_by_user_id', user.id).orderBy('id')

    return invitations.map((invitation) => ({
      role: invitation.role,
      sentAt: iso(invitation.createdAt),
      acceptedAt: iso(invitation.acceptedAt),
      revokedAt: iso(invitation.revokedAt),
    }))
  },

  /**
   * Pending invitations go: each holds somebody else's address for no
   * reason once the person who sent it has left. Accepted and revoked ones
   * stay as the workspace's history.
   */
  async erase(user: User, { trx }: PrivacyEraseContext) {
    await Invitation.query({ client: trx })
      .where('invited_by_user_id', user.id)
      .whereNull('accepted_at')
      .whereNull('revoked_at')
      .delete()
  },
}

export const apiKeysContributor: PrivacyContributor = {
  key: 'apiKeysCreated',
  describes: 'API keys you created: name, visible prefix, scopes and dates.',
  excludes: 'The keys themselves — only a hash is stored, and the key is a credential.',
  covers: ['api_keys.created_by_user_id'],

  async export(user: User) {
    const keys = await ApiKey.query().where('created_by_user_id', user.id).orderBy('id')

    return keys.map((key) => ({
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      createdAt: iso(key.createdAt),
      lastUsedAt: iso(key.lastUsedAt),
      revokedAt: iso(key.revokedAt),
    }))
  },
}

export const supportContributor: PrivacyContributor = {
  key: 'supportTickets',
  describes: 'Support tickets you opened, with the whole conversation.',
  excludes: "Staff members' names — replies are attributed to Support.",
  covers: ['support_tickets.created_by_user_id', 'support_messages.author_user_id'],

  async export(user: User) {
    const tickets = await SupportTicket.query()
      .where('created_by_user_id', user.id)
      .preload('messages', (query) => query.orderBy('id'))
      .orderBy('id')

    return tickets.map((ticket) => ({
      id: ticket.publicId,
      subject: ticket.subject,
      status: ticket.status,
      openedAt: iso(ticket.createdAt),
      messages: ticket.messages.map((message) => ({
        from: message.authorType === 'staff' ? 'Support' : 'You',
        body: message.body,
        sentAt: iso(message.createdAt),
      })),
    }))
  },
}

export const activityContributor: PrivacyContributor = {
  key: 'activity',
  describes:
    'Significant actions recorded under your account, with when they happened and the address and browser they came from.',
  covers: ['audit_logs.actor_id'],

  async export(user: User) {
    const entries = await AuditLog.query()
      .where('actor_type', 'user')
      .where('actor_id', user.id)
      .orderBy('id')

    return entries.map((entry) => ({
      action: entry.action,
      at: iso(entry.createdAt),
      ip: entry.ip,
      userAgent: entry.userAgent,
    }))
  },

  /**
   * The entries stay — they are the security record — but the network
   * identifiers that tie them to a person are cleared (plan §22.8.4).
   */
  async erase(user: User, { trx }: PrivacyEraseContext) {
    await AuditLog.query({ client: trx })
      .where('actor_type', 'user')
      .where('actor_id', user.id)
      .update({ ip: null, user_agent: null })
  },
}

export const coreContributors = [
  accountContributor,
  workspaceContributor,
  socialAccountsContributor,
  authTokensContributor,
  filesContributor,
  invitationsContributor,
  apiKeysContributor,
  supportContributor,
  activityContributor,
]
