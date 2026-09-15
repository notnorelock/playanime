import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, fk, primaryId, timestamps } from './_shared.js';
import { episodes } from './anime.js';
import { users } from './users.js';

/**
 * Watch parties.
 *
 * Postgres holds only the durable facts: who owns the room, what is queued, who
 * is a member. The *live* playback position is not here — it lives in Redis,
 * because it changes constantly and losing it on restart costs nothing beyond a
 * resync.
 *
 * Writing playback position to Postgres on every seek would produce thousands
 * of writes per room per hour for data with a lifetime of seconds.
 */
export const watchParties = pgTable(
  'watch_parties',
  {
    id: primaryId(),

    /** Short shareable code, e.g. `PLAY-7K2M`. */
    inviteCode: varchar('invite_code', { length: 16 }).notNull(),

    hostUserId: fk('host_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Currently selected episode. Null between selections. */
    episodeId: fk('episode_id').references(() => episodes.id, { onDelete: 'set null' }),

    name: varchar('name', { length: 100 }),

    isPublic: boolean('is_public').notNull().default(false),
    maxMembers: smallint('max_members').notNull().default(20),

    /** Set when the host ends the room; rows are kept for history. */
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('watch_parties_invite_code_key').on(table.inviteCode),
    // The public room browser.
    index('watch_parties_public_idx')
      .on(sql`${table.lastActivityAt} desc`)
      .where(sql`${table.isPublic} = true and ${table.endedAt} is null`),
    index('watch_parties_host_idx').on(table.hostUserId),
    // Supports the reaper that closes abandoned rooms.
    index('watch_parties_stale_idx')
      .on(table.lastActivityAt)
      .where(sql`${table.endedAt} is null`),
  ],
);

export const watchPartyMembers = pgTable(
  'watch_party_members',
  {
    id: primaryId(),
    partyId: fk('party_id')
      .references(() => watchParties.id, { onDelete: 'cascade' })
      .notNull(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Permits playback control when the host delegates it. */
    canControlPlayback: boolean('can_control_playback').notNull().default(false),

    joinedAt: createdAt(),
    leftAt: timestamp('left_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // One active membership per user per room.
    uniqueIndex('watch_party_members_active_key')
      .on(table.partyId, table.userId)
      .where(sql`${table.leftAt} is null`),
    index('watch_party_members_party_idx').on(table.partyId),
    index('watch_party_members_user_idx').on(table.userId),
  ],
);

/**
 * Chat history.
 *
 * Persisted so a member joining late sees recent context. Retention is
 * deliberately short — a cleanup job trims old rows, since watch-party chat has
 * no archival value and every retained message is moderation surface.
 */
export const watchPartyMessages = pgTable(
  'watch_party_messages',
  {
    id: primaryId(),
    partyId: fk('party_id')
      .references(() => watchParties.id, { onDelete: 'cascade' })
      .notNull(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Plain text. Never stored or rendered as HTML. */
    body: varchar('body', { length: 1000 }).notNull(),

    /** Playback position when sent, so replays can align chat to the video. */
    positionSeconds: integer('position_seconds'),

    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),

    createdAt: createdAt(),
  },
  (table) => [
    index('watch_party_messages_party_idx')
      .on(table.partyId, sql`${table.createdAt} desc`)
      .where(sql`${table.removedAt} is null`),
  ],
);

export const watchPartiesRelations = relations(watchParties, ({ one, many }) => ({
  host: one(users, { fields: [watchParties.hostUserId], references: [users.id] }),
  episode: one(episodes, { fields: [watchParties.episodeId], references: [episodes.id] }),
  members: many(watchPartyMembers),
  messages: many(watchPartyMessages),
}));

export const watchPartyMembersRelations = relations(watchPartyMembers, ({ one }) => ({
  party: one(watchParties, { fields: [watchPartyMembers.partyId], references: [watchParties.id] }),
  user: one(users, { fields: [watchPartyMembers.userId], references: [users.id] }),
}));

export const watchPartyMessagesRelations = relations(watchPartyMessages, ({ one }) => ({
  party: one(watchParties, { fields: [watchPartyMessages.partyId], references: [watchParties.id] }),
  user: one(users, { fields: [watchPartyMessages.userId], references: [users.id] }),
}));

export type WatchPartyRow = typeof watchParties.$inferSelect;
export type WatchPartyMemberRow = typeof watchPartyMembers.$inferSelect;
export type WatchPartyMessageRow = typeof watchPartyMessages.$inferSelect;
