import { relations, sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createdAt, fk, primaryId, timestamps } from './_shared.js';
import { users } from './users.js';

/**
 * Sessions.
 *
 * Server-side sessions rather than stateless JWTs, because revocation must be
 * immediate: a user signing out a stolen device, or a moderator suspending an
 * account, cannot wait for a token to expire.
 *
 * The cookie carries an opaque random token; only its SHA-256 hash is stored.
 * A database leak therefore does not hand the attacker usable sessions, the
 * same reasoning that applies to password hashes.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** SHA-256 of the session token. The raw token is never persisted. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** Rolling activity, used to expire idle sessions and to show device lists. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),

    /** Truncated at the API edge; kept for the "your devices" screen. */
    userAgent: varchar('user_agent', { length: 512 }),
    /** `inet` would be tighter, but varchar keeps the column driver-agnostic. */
    ipAddress: varchar('ip_address', { length: 45 }),

    /** Set when revoked explicitly; the row is kept for audit. */
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: varchar('revoked_reason', { length: 64 }),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_key').on(table.tokenHash),
    // Session lookup happens on every authenticated request: this index is the
    // hottest in the schema. Partial, because revoked rows are never looked up.
    index('sessions_user_active_idx')
      .on(table.userId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
    // Supports the cleanup job that deletes expired sessions.
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

/**
 * Linked OAuth accounts.
 *
 * Separate from `users` so one account can hold several providers, and so
 * adding a provider never touches the user table.
 */
export const oauthAccounts = pgTable(
  'oauth_accounts',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    provider: varchar('provider', { length: 32 }).notNull(),
    /** The provider's stable user id, not the email — emails change. */
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),

    /**
     * Provider tokens, when a feature needs to call the provider's API later.
     * Encrypted at the application layer before they reach this column.
     */
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true, mode: 'date' }),

    ...timestamps(),
  },
  (table) => [
    // One link per provider identity, so two users cannot claim the same one.
    uniqueIndex('oauth_accounts_provider_account_key').on(table.provider, table.providerAccountId),
    index('oauth_accounts_user_idx').on(table.userId),
  ],
);

/**
 * TOTP (RFC 6238) two-factor authentication.
 *
 * One row per user, created in a disabled state by `/auth/2fa/setup` and
 * flipped on by `/auth/2fa/confirm` once the caller proves possession of the
 * secret with a real code — a secret nobody has confirmed reading is not
 * protecting anything and must not gate login.
 */
export const twoFactorSecrets = pgTable('two_factor_secrets', {
  id: primaryId(),
  userId: fk('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),

  /**
   * AES-256-GCM ciphertext of the base32 TOTP secret, keyed from
   * `SESSION_SECRET`. Plaintext here would mean a database leak alone is
   * enough to generate valid codes for every 2FA-protected account — strictly
   * worse than a leaked password hash, which still needs cracking.
   */
  encryptedSecret: text('encrypted_secret').notNull(),

  enabledAt: timestamp('enabled_at', { withTimezone: true, mode: 'date' }),

  /** SHA-256 hashes of unused one-time recovery codes; consumed entries are removed, not flagged. */
  recoveryCodeHashes: text('recovery_code_hashes').array().notNull().default([]),

  ...timestamps(),
});

/**
 * Devices that skip the 2FA prompt for a while after a successful challenge.
 *
 * Keyed the same way as `sessions` — an opaque token in the cookie, only its
 * hash stored — for the same reason: a database leak must not hand out usable
 * device trust.
 */
export const trustedDevices = pgTable(
  'trusted_devices',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),

    /** Shown on a "trusted devices" screen, same reasoning as `sessions.userAgent`. */
    userAgent: varchar('user_agent', { length: 512 }),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('trusted_devices_token_hash_key').on(table.tokenHash),
    index('trusted_devices_user_idx').on(table.userId),
  ],
);

/**
 * Single-use tokens for email verification and password reset.
 *
 * One table with a `purpose` discriminator rather than two near-identical
 * tables: the lifecycle (issue, hash, expire, consume once) is the same, and a
 * shared cleanup job covers both.
 */
export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** SHA-256 of the emailed token. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),

    /** `email_verification` | `password_reset` | `email_change`. */
    purpose: varchar('purpose', { length: 32 }).notNull(),

    /** For an email-change flow, the address being moved to. */
    payload: varchar('payload', { length: 254 }),

    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Set on use. Enforces single use without deleting the audit trail. */
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('verification_tokens_hash_key').on(table.tokenHash),
    // Rate-limits reissue: "how many reset mails has this user requested?"
    index('verification_tokens_user_purpose_idx').on(table.userId, table.purpose, table.createdAt),
    index('verification_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, { fields: [oauthAccounts.userId], references: [users.id] }),
}));

export const verificationTokensRelations = relations(verificationTokens, ({ one }) => ({
  user: one(users, { fields: [verificationTokens.userId], references: [users.id] }),
}));

export const twoFactorSecretsRelations = relations(twoFactorSecrets, ({ one }) => ({
  user: one(users, { fields: [twoFactorSecrets.userId], references: [users.id] }),
}));

export const trustedDevicesRelations = relations(trustedDevices, ({ one }) => ({
  user: one(users, { fields: [trustedDevices.userId], references: [users.id] }),
}));

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type OAuthAccountRow = typeof oauthAccounts.$inferSelect;
export type VerificationTokenRow = typeof verificationTokens.$inferSelect;
export type TwoFactorSecretRow = typeof twoFactorSecrets.$inferSelect;
export type TrustedDeviceRow = typeof trustedDevices.$inferSelect;
