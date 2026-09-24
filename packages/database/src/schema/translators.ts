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
  createdAt,
  deletedAt,
  episodeCreditRoleEnum,
  fk,
  primaryId,
  timestamps,
  translatorRoleEnum,
} from './_shared.js';
import { entries, episodes } from './anime.js';
import { users } from './users.js';

/**
 * Fansub groups.
 *
 * PlayAnime does not host video; the people who do the translation work are the
 * reason a source exists at all, so a group is a first-class entity with its
 * own page, membership and credits rather than a string on an episode.
 *
 * A group is owned by its members, not by the platform: the leader roster is
 * what grants administrative rights over the group, and the platform's own
 * moderators intervene only through the audit-logged moderation path.
 */
export const translatorGroups = pgTable(
  'translator_groups',
  {
    id: primaryId(),

    /** Stable public identifier used in URLs. Never reused after deletion. */
    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 2000 }),

    avatarUrl: text('avatar_url'),
    bannerUrl: text('banner_url'),

    /** Where the group publishes outside PlayAnime. */
    websiteUrl: text('website_url'),
    discordUrl: text('discord_url'),

    /**
     * Whether the group accepts join requests.
     *
     * A closed group is still public: this controls applications, not
     * visibility, which would be a different and much more invasive feature.
     */
    isRecruiting: boolean('is_recruiting').notNull().default(false),

    /**
     * Platform verification.
     *
     * Set only by a staff member, and only after confirming the group is who it
     * claims to be. Groups cannot grant it to themselves, which is the entire
     * point of the badge.
     */
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    verifiedByUserId: fk('verified_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    /** Denormalized for listings; maintained by the repository on membership change. */
    memberCount: integer('member_count').notNull().default(0),
    entryCount: integer('entry_count').notNull().default(0),

    /** Moderator suspension. The group's pages stop rendering but rows survive. */
    suspendedAt: timestamp('suspended_at', { withTimezone: true, mode: 'date' }),
    suspensionReason: text('suspension_reason'),

    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('translator_groups_slug_key').on(table.slug),
    // Case-insensitive name uniqueness: two groups differing only by case would
    // be indistinguishable to a viewer and are almost always impersonation.
    uniqueIndex('translator_groups_name_lower_key').on(sql`lower(${table.name})`),
    // The public directory: live groups, most recently active first.
    index('translator_groups_directory_idx')
      .on(sql`${table.updatedAt} desc`)
      .where(sql`${table.deletedAt} is null and ${table.suspendedAt} is null`),
    index('translator_groups_recruiting_idx')
      .on(table.updatedAt)
      .where(sql`${table.isRecruiting} = true and ${table.deletedAt} is null`),
  ],
);

/**
 * Group membership.
 *
 * The role decides what a member may do inside the group. `leader` is the only
 * role that can change membership or group settings, and the repository refuses
 * to remove or demote the last one — a group with no leader can never be
 * administered again, and recovering it would require direct database access.
 */
export const translatorMembers = pgTable(
  'translator_members',
  {
    id: primaryId(),
    groupId: fk('group_id')
      .references(() => translatorGroups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    role: translatorRoleEnum('role').notNull().default('member'),

    /** Free-text credit, e.g. "Tłumaczenie odc. 1-12". Shown on the group page. */
    creditNote: varchar('credit_note', { length: 200 }),

    invitedByUserId: fk('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps(),
  },
  (table) => [
    // One membership per user per group; a second row would double their vote
    // in any leader count.
    uniqueIndex('translator_members_group_user_key').on(table.groupId, table.userId),
    index('translator_members_user_idx').on(table.userId),
    // "Who leads this group" — the check that gates every group mutation.
    index('translator_members_leaders_idx')
      .on(table.groupId)
      .where(sql`${table.role} = 'leader'`),
  ],
);

/**
 * Pending applications to join a group.
 *
 * Kept after a decision rather than deleted, so a group can see that it already
 * rejected an applicant instead of reconsidering the same request repeatedly.
 */
export const translatorApplications = pgTable(
  'translator_applications',
  {
    id: primaryId(),
    groupId: fk('group_id')
      .references(() => translatorGroups.id, { onDelete: 'cascade' })
      .notNull(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    message: varchar('message', { length: 1000 }),

    /** `pending` | `accepted` | `rejected` | `withdrawn`. */
    status: varchar('status', { length: 16 }).notNull().default('pending'),

    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    decidedByUserId: fk('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps(),
  },
  (table) => [
    // Only one open application per user per group. Partial, so a rejected
    // application does not block a later, better one.
    uniqueIndex('translator_applications_open_key')
      .on(table.groupId, table.userId)
      .where(sql`${table.status} = 'pending'`),
    index('translator_applications_queue_idx')
      .on(table.groupId, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    index('translator_applications_user_idx').on(table.userId, sql`${table.createdAt} desc`),
  ],
);

/**
 * Which entries (releases) a group works on.
 *
 * A many-to-many: two groups may translate the same release, and one group
 * works on many. Scoped to `entries`, not `series` — a group claims "Season
 * 2," not "the whole franchise," which is the same reason `episodeRange`
 * exists: real claims are rarely "everything" and the platform should not
 * pretend to model something it cannot verify.
 */
export const translatorAnime = pgTable(
  'translator_anime',
  {
    id: primaryId(),
    groupId: fk('group_id')
      .references(() => translatorGroups.id, { onDelete: 'cascade' })
      .notNull(),
    entryId: fk('entry_id')
      .references(() => entries.id, { onDelete: 'cascade' })
      .notNull(),

    /** e.g. "1-12", "OVA". Free text: an unverifiable claim, labelled as such. */
    episodeRange: varchar('episode_range', { length: 64 }),
    note: varchar('note', { length: 500 }),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('translator_anime_group_entry_key').on(table.groupId, table.entryId),
    // "Which groups translate this release" — rendered on the entry page.
    index('translator_anime_entry_idx').on(table.entryId),
  ],
);

/**
 * Who did what on one episode — shown under the player as "Tłumaczenie: ...",
 * "Korekta: ...", "QC: ...", "Typesetting: ...". A row per (episode, member,
 * role): the same member can be credited in more than one role on the same
 * episode (e.g. one person both translates and does QC), and a role can have
 * more than one credited member.
 *
 * `userId` (not a free-typed name) so a credit always resolves to a real
 * user with a real profile — deliberately no guest/non-member path.
 * `groupId` is redundant with `translator_members` in principle (the member
 * row already implies a group) but kept explicit here so a credit survives
 * the member later leaving the group, and so the query that renders credits
 * for an episode never needs to join through membership history.
 *
 * `groupId` is nullable: null means this credit is to a staff member acting
 * with no group at all (the same "PlayAnime staff" / no-group sentinel used
 * everywhere else a group can be omitted in the catalogue) rather than to a
 * translator group's member. `userId` is still required either way — only
 * the group attribution is optional, never who did the work.
 */
export const episodeCredits = pgTable(
  'translator_episode_credits',
  {
    id: primaryId(),
    episodeId: fk('episode_id')
      .references(() => episodes.id, { onDelete: 'cascade' })
      .notNull(),
    groupId: fk('group_id').references(() => translatorGroups.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    role: episodeCreditRoleEnum('role').notNull(),

    createdAt: createdAt(),
  },
  (table) => [
    // One credit per (episode, person, role) — crediting the same person
    // twice for the same role on the same episode would just be a duplicate.
    uniqueIndex('episode_credits_key').on(table.episodeId, table.userId, table.role),
    // The credits panel under the player: "everyone credited on this episode".
    index('episode_credits_episode_idx').on(table.episodeId),
    index('episode_credits_user_idx').on(table.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const translatorGroupsRelations = relations(translatorGroups, ({ many }) => ({
  members: many(translatorMembers),
  applications: many(translatorApplications),
  titles: many(translatorAnime),
}));

export const translatorMembersRelations = relations(translatorMembers, ({ one }) => ({
  group: one(translatorGroups, {
    fields: [translatorMembers.groupId],
    references: [translatorGroups.id],
  }),
  user: one(users, { fields: [translatorMembers.userId], references: [users.id] }),
}));

export const translatorApplicationsRelations = relations(translatorApplications, ({ one }) => ({
  group: one(translatorGroups, {
    fields: [translatorApplications.groupId],
    references: [translatorGroups.id],
  }),
  user: one(users, { fields: [translatorApplications.userId], references: [users.id] }),
}));

export const translatorAnimeRelations = relations(translatorAnime, ({ one }) => ({
  group: one(translatorGroups, {
    fields: [translatorAnime.groupId],
    references: [translatorGroups.id],
  }),
  entry: one(entries, { fields: [translatorAnime.entryId], references: [entries.id] }),
}));

export const episodeCreditsRelations = relations(episodeCredits, ({ one }) => ({
  group: one(translatorGroups, {
    fields: [episodeCredits.groupId],
    references: [translatorGroups.id],
  }),
  episode: one(episodes, {
    fields: [episodeCredits.episodeId],
    references: [episodes.id],
  }),
  user: one(users, { fields: [episodeCredits.userId], references: [users.id] }),
}));

export type TranslatorGroupRow = typeof translatorGroups.$inferSelect;
export type NewTranslatorGroupRow = typeof translatorGroups.$inferInsert;
export type TranslatorMemberRow = typeof translatorMembers.$inferSelect;
export type TranslatorApplicationRow = typeof translatorApplications.$inferSelect;
export type EpisodeCreditRow = typeof episodeCredits.$inferSelect;
export type NewEpisodeCreditRow = typeof episodeCredits.$inferInsert;
export type TranslatorAnimeRow = typeof translatorAnime.$inferSelect;
