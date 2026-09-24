import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  deletedAt,
  fk,
  primaryId,
  sourceLanguageEnum,
  timestamps,
  userRoleEnum,
} from './_shared.js';

/**
 * Users and profiles.
 *
 * `users` holds identity and credentials; `profiles` holds the public persona.
 * They are separate because they have different access patterns and different
 * exposure: a profile is read on every comment render and is fully public,
 * while a user row contains the password hash and is read only during
 * authentication. Keeping them apart makes it hard to accidentally select a
 * credential column into a public response.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),

    /**
     * Stored as entered; uniqueness is enforced case-insensitively by the index
     * below. Normalizing to lowercase on write would corrupt the local part of
     * addresses that are technically case-sensitive.
     */
    email: varchar('email', { length: 254 }).notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),

    username: varchar('username', { length: 32 }).notNull(),

    /**
     * Argon2id hash. Null for accounts that exist only through an OAuth
     * provider and have never set a password.
     */
    passwordHash: text('password_hash'),

    role: userRoleEnum('role').notNull().default('user'),

    /** Set when a moderator suspends the account; blocks session creation. */
    suspendedAt: timestamp('suspended_at', { withTimezone: true, mode: 'date' }),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true, mode: 'date' }),
    suspensionReason: text('suspension_reason'),

    /**
     * VIP fast path — mirrors the active grant in `profile_roles`, the
     * same way `suspendedAt`/`suspendedUntil` mirror the active row in
     * `user_sanctions`. Null means not VIP; a future timestamp means VIP
     * until then. Read on every VIP-gated request (a watch bootstrap, an
     * episode list) without a join; `profile_roles` is the full grant
     * history (who granted it, when, for how long, who revoked it) and is
     * never read on that hot path.
     */
    vipUntil: timestamp('vip_until', { withTimezone: true, mode: 'date' }),

    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),

    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    // Case-insensitive uniqueness: two accounts must not differ only by case.
    uniqueIndex('users_email_lower_key').on(sql`lower(${table.email})`),
    uniqueIndex('users_username_lower_key').on(sql`lower(${table.username})`),
    // Partial index: the moderation queue only ever scans live accounts.
    index('users_active_idx').on(table.createdAt).where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * Every avatar a user has ever uploaded — kept forever, pruned only by the
 * user's own explicit delete, never automatically. `profiles.avatarUrl`
 * mirrors whichever row (if any) is current, via `currentAvatarUploadId`,
 * so every consumer that already reads `avatarUrl` as a plain string
 * (session, comments, admin, ...) needs no change — this table only backs
 * the avatar-management UI (crop, history, size variants) itself.
 *
 * `contentHash` (sha256 of the final WebP bytes) makes re-uploading a
 * pixel-identical image a no-op that reuses the existing row and files
 * instead of writing a duplicate — enforced by the partial unique index
 * below (partial so a soft-deleted upload doesn't block re-uploading the
 * same image again later).
 */
export const avatarUploads = pgTable(
  'avatar_uploads',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    /** Relative path stem under CDN_UPLOAD_ROOT, e.g. "avatars/<userId>/<contentHash>" — each size variant appends "_<size>.webp". */
    storagePath: text('storage_path').notNull(),

    fileSizeBytes: integer('file_size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),

    deletedAt: deletedAt(),
    ...timestamps(),
  },
  (table) => [
    index('avatar_uploads_user_idx').on(table.userId, sql`${table.createdAt} desc`),
    uniqueIndex('avatar_uploads_user_hash_key')
      .on(table.userId, table.contentHash)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const avatarUploadsRelations = relations(avatarUploads, ({ one }) => ({
  user: one(users, { fields: [avatarUploads.userId], references: [users.id] }),
}));

export type AvatarUploadRow = typeof avatarUploads.$inferSelect;
export type NewAvatarUploadRow = typeof avatarUploads.$inferInsert;

/** Public persona. One per user, split from credentials. */
export const profiles = pgTable(
  'profiles',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    displayName: varchar('display_name', { length: 64 }),
    bio: varchar('bio', { length: 500 }),
    pronouns: varchar('pronouns', { length: 30 }),
    /**
     * The resolved, currently-effective avatar URL — kept in sync by the
     * media service on every upload/activate/external-URL change. This is
     * what every ordinary consumer reads; it stays a plain string on
     * purpose even though avatars now have history and size variants (see
     * `avatarUploads`), so nothing outside avatar management itself needs
     * to change.
     */
    avatarUrl: text('avatar_url'),
    bannerUrl: text('banner_url'),
    /** Which `avatarUploads` row `avatarUrl` currently mirrors — null when `avatarUrl` is an external URL (or unset) rather than one of the user's own uploads. */
    currentAvatarUploadId: fk('current_avatar_upload_id').references(() => avatarUploads.id, {
      onDelete: 'set null',
    }),

    /** Denormalized counters, maintained by triggers or background jobs. */
    followerCount: integer('follower_count').notNull().default(0),
    followingCount: integer('following_count').notNull().default(0),
    completedCount: integer('completed_count').notNull().default(0),

    ...timestamps(),
  },
  (table) => [uniqueIndex('profiles_user_id_key').on(table.userId)],
);

/**
 * Per-user preferences.
 *
 * Separate from `profiles` because these are read on nearly every playback
 * request (to rank sources by language) while profile fields are not, and
 * because they are private where profile fields are public.
 */
export const userPreferences = pgTable(
  'user_preferences',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Interface language. Polish default, matching the product's audience. */
    locale: varchar('locale', { length: 10 }).notNull().default('pl'),

    /** Drives source ranking in @playanime/external-media. */
    preferredAudioLanguage: sourceLanguageEnum('preferred_audio_language'),
    preferredSubtitleLanguage: sourceLanguageEnum('preferred_subtitle_language').default('pl'),

    /** Hides titles rated `rx`, and blurs mature artwork in listings. */
    showMatureContent: boolean('show_mature_content').notNull().default(false),

    autoplayNextEpisode: boolean('autoplay_next_episode').notNull().default(true),
    skipIntroAutomatically: boolean('skip_intro_automatically').notNull().default(false),

    emailNotifications: boolean('email_notifications').notNull().default(true),

    ...timestamps(),
  },
  (table) => [uniqueIndex('user_preferences_user_id_key').on(table.userId)],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
  preferences: one(userPreferences, { fields: [users.id], references: [userPreferences.userId] }),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
  currentAvatarUpload: one(avatarUploads, {
    fields: [profiles.currentAvatarUploadId],
    references: [avatarUploads.id],
  }),
}));

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users, { fields: [userPreferences.userId], references: [users.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type ProfileRow = typeof profiles.$inferSelect;
export type UserPreferencesRow = typeof userPreferences.$inferSelect;
