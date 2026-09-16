import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  fk,
  primaryId,
  reactionKindEnum,
  timestamps,
  watchStatusEnum,
} from './_shared.js';
import { anime, episodes } from './anime.js';
import { users } from './users.js';

/**
 * A user's library entry for a title.
 *
 * One row per (user, anime): the status is a property of that pairing, not a
 * separate list membership. Custom lists are a different concept and live in
 * `custom_lists`.
 */
export const libraryEntries = pgTable(
  'library_entries',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    animeId: fk('anime_id')
      .references(() => anime.id, { onDelete: 'cascade' })
      .notNull(),

    status: watchStatusEnum('status').notNull().default('planned'),

    /** Episodes finished. Denormalized from `episode_progress` for list views. */
    progressEpisodes: smallint('progress_episodes').notNull().default(0),
    rewatchCount: smallint('rewatch_count').notNull().default(0),

    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),

    notes: varchar('notes', { length: 1000 }),
    isPrivate: boolean('is_private').notNull().default(false),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('library_entries_user_anime_key').on(table.userId, table.animeId),
    // The profile library view, filtered by tab.
    index('library_entries_user_status_idx').on(table.userId, table.status, table.updatedAt),
    // "How many users have this in their library" and reverse lookups.
    index('library_entries_anime_idx').on(table.animeId, table.status),
  ],
);

/**
 * Per-episode playback progress.
 *
 * Separate from `library_entries` because it is written far more often — every
 * few seconds during playback — and read in a different shape. Keeping the hot
 * write path off the library row avoids contention on a row the profile page
 * reads constantly.
 *
 * This is what makes resume-across-devices work: position is server-side, keyed
 * by user and episode, with no dependence on which client wrote it.
 */
export const episodeProgress = pgTable(
  'episode_progress',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    episodeId: fk('episode_id')
      .references(() => episodes.id, { onDelete: 'cascade' })
      .notNull(),
    /** Denormalized so "continue watching" needs no join through episodes. */
    animeId: fk('anime_id')
      .references(() => anime.id, { onDelete: 'cascade' })
      .notNull(),

    positionSeconds: integer('position_seconds').notNull().default(0),
    /** Runtime as the client measured it; may differ from catalogue metadata. */
    durationSeconds: integer('duration_seconds'),

    /** Set once the viewer passes the completion threshold (typically ~90%). */
    isCompleted: boolean('is_completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),

    lastWatchedAt: timestamp('last_watched_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('episode_progress_user_episode_key').on(table.userId, table.episodeId),
    // The "continue watching" rail: most recent unfinished episodes.
    index('episode_progress_continue_idx')
      .on(table.userId, sql`${table.lastWatchedAt} desc`)
      .where(sql`${table.isCompleted} = false`),
    index('episode_progress_user_anime_idx').on(table.userId, table.animeId),
  ],
);

/** User-created lists, independent of watch status. */
export const customLists = pgTable(
  'custom_lists',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    slug: varchar('slug', { length: 96 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 1000 }),

    isPublic: boolean('is_public').notNull().default(true),
    itemCount: integer('item_count').notNull().default(0),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('custom_lists_user_slug_key').on(table.userId, table.slug),
    index('custom_lists_public_idx')
      .on(sql`${table.updatedAt} desc`)
      .where(sql`${table.isPublic} = true`),
  ],
);

export const customListItems = pgTable(
  'custom_list_items',
  {
    id: primaryId(),
    listId: fk('list_id')
      .references(() => customLists.id, { onDelete: 'cascade' })
      .notNull(),
    animeId: fk('anime_id')
      .references(() => anime.id, { onDelete: 'cascade' })
      .notNull(),

    /** Manual ordering within the list. */
    position: integer('position').notNull().default(0),
    note: varchar('note', { length: 500 }),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('custom_list_items_list_anime_key').on(table.listId, table.animeId),
    index('custom_list_items_order_idx').on(table.listId, table.position),
  ],
);

/**
 * Ratings.
 *
 * `animeId` and `episodeId` are both nullable with exactly one required, so
 * episode ratings can be added later without a second table or a migration of
 * existing rows.
 */
export const ratings = pgTable(
  'ratings',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    animeId: fk('anime_id').references(() => anime.id, { onDelete: 'cascade' }),
    episodeId: fk('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),

    /** 1-10 whole stars. Half-points would invalidate existing data later. */
    score: smallint('score').notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('ratings_user_anime_key')
      .on(table.userId, table.animeId)
      .where(sql`${table.animeId} is not null`),
    uniqueIndex('ratings_user_episode_key')
      .on(table.userId, table.episodeId)
      .where(sql`${table.episodeId} is not null`),
    index('ratings_anime_idx').on(table.animeId),
  ],
);

/**
 * Lightweight reactions, independent of ratings.
 *
 * A user may react without scoring, and vice versa. Kept separate so the rating
 * aggregate is not polluted by what is really an engagement signal.
 */
export const reactions = pgTable(
  'reactions',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    animeId: fk('anime_id').references(() => anime.id, { onDelete: 'cascade' }),
    episodeId: fk('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),

    kind: reactionKindEnum('kind').notNull(),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('reactions_user_anime_kind_key')
      .on(table.userId, table.animeId, table.kind)
      .where(sql`${table.animeId} is not null`),
    uniqueIndex('reactions_user_episode_kind_key')
      .on(table.userId, table.episodeId, table.kind)
      .where(sql`${table.episodeId} is not null`),
    index('reactions_anime_idx').on(table.animeId, table.kind),
  ],
);

/* -------------------------------------------------------------------------- */
/* Social                                                                      */
/* -------------------------------------------------------------------------- */

export const follows = pgTable(
  'follows',
  {
    followerId: fk('follower_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    followingId: fk('following_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('follows_pkey').on(table.followerId, table.followingId),
    // "Who follows this user" — the reverse of the primary key order.
    index('follows_following_idx').on(table.followingId),
  ],
);

/**
 * Comments and reviews.
 *
 * One table with a nullable `parentId` for threading, and a `rating` that marks
 * a top-level comment as a review. Two tables would duplicate the entire
 * moderation surface for no structural gain.
 *
 * `body` is plain text. It is never stored as HTML and never rendered as HTML —
 * user-generated markup is not trusted anywhere in PlayAnime.
 */
export const comments = pgTable(
  'comments',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    animeId: fk('anime_id').references(() => anime.id, { onDelete: 'cascade' }),
    episodeId: fk('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),

    parentId: fk('parent_id'),

    body: text('body').notNull(),

    /** Present when this comment is a review. */
    rating: smallint('rating'),
    /** Hides a review body behind a spoiler gate. */
    hasSpoilers: boolean('has_spoilers').notNull().default(false),

    likeCount: integer('like_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),

    /** Moderator removal. The row is retained for the audit trail. */
    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
    removedByUserId: fk('removed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    removalReason: text('removal_reason'),

    ...timestamps(),
  },
  (table) => [
    // The comment thread for a title, newest first, excluding removed rows.
    index('comments_anime_idx')
      .on(table.animeId, sql`${table.createdAt} desc`)
      .where(sql`${table.removedAt} is null`),
    index('comments_episode_idx')
      .on(table.episodeId, sql`${table.createdAt} desc`)
      .where(sql`${table.removedAt} is null`),
    index('comments_parent_idx').on(table.parentId),
    index('comments_user_idx').on(table.userId),
  ],
);

/**
 * Who liked which comment.
 *
 * `comments.like_count` is the denormalized total the thread renders; this
 * table is what makes the count correct and idempotent. Without it a like is
 * just an increment, so a double-click inflates the number permanently and
 * "have I already liked this?" is unanswerable.
 *
 * The count and this table are always written in the same transaction.
 */
export const commentLikes = pgTable(
  'comment_likes',
  {
    commentId: fk('comment_id')
      .references(() => comments.id, { onDelete: 'cascade' })
      .notNull(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // Composite primary key: one like per user per comment, enforced by the
    // database rather than by a check the application might skip.
    uniqueIndex('comment_likes_pkey').on(table.commentId, table.userId),
    // "Which comments in this thread has the viewer liked" — one indexed read
    // per thread render instead of one per comment.
    index('comment_likes_user_idx').on(table.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const libraryEntriesRelations = relations(libraryEntries, ({ one }) => ({
  user: one(users, { fields: [libraryEntries.userId], references: [users.id] }),
  anime: one(anime, { fields: [libraryEntries.animeId], references: [anime.id] }),
}));

export const episodeProgressRelations = relations(episodeProgress, ({ one }) => ({
  user: one(users, { fields: [episodeProgress.userId], references: [users.id] }),
  episode: one(episodes, { fields: [episodeProgress.episodeId], references: [episodes.id] }),
  anime: one(anime, { fields: [episodeProgress.animeId], references: [anime.id] }),
}));

export const customListsRelations = relations(customLists, ({ one, many }) => ({
  user: one(users, { fields: [customLists.userId], references: [users.id] }),
  items: many(customListItems),
}));

export const customListItemsRelations = relations(customListItems, ({ one }) => ({
  list: one(customLists, { fields: [customListItems.listId], references: [customLists.id] }),
  anime: one(anime, { fields: [customListItems.animeId], references: [anime.id] }),
}));

export const ratingsRelations = relations(ratings, ({ one }) => ({
  user: one(users, { fields: [ratings.userId], references: [users.id] }),
  anime: one(anime, { fields: [ratings.animeId], references: [anime.id] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  user: one(users, { fields: [comments.userId], references: [users.id] }),
  anime: one(anime, { fields: [comments.animeId], references: [anime.id] }),
  parent: one(comments, { fields: [comments.parentId], references: [comments.id] }),
  replies: many(comments),
}));

export type LibraryEntryRow = typeof libraryEntries.$inferSelect;
export type EpisodeProgressRow = typeof episodeProgress.$inferSelect;
export type CustomListRow = typeof customLists.$inferSelect;
export type RatingRow = typeof ratings.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type CommentLikeRow = typeof commentLikes.$inferSelect;
