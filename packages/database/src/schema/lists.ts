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
import { episodes, series } from './anime.js';
import { users } from './users.js';

/**
 * A user's library entry for a series.
 *
 * One row per (user, series): the status is a property of that pairing, not
 * a separate list membership — scoped to `series`, not `entries`, per the
 * product decision that a user tracks "Attack on Titan" as a whole, not
 * "Attack on Titan Season 2" separately. Custom lists are a different
 * concept and live in `custom_lists`.
 */
export const libraryEntries = pgTable(
  'library_entries',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    seriesId: fk('series_id')
      .references(() => series.id, { onDelete: 'cascade' })
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
    uniqueIndex('library_entries_user_series_key').on(table.userId, table.seriesId),
    // The profile library view, filtered by tab.
    index('library_entries_user_status_idx').on(table.userId, table.status, table.updatedAt),
    // "How many users have this in their library" and reverse lookups.
    index('library_entries_series_idx').on(table.seriesId, table.status),
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
    /**
     * Denormalized so "continue watching" needs no join through
     * episode -> entry -> series. Resolved through that chain at write
     * time — the series a user is "continuing," not any one entry, since
     * several seasons of the same series can restart episode numbering
     * from 1 and the UI still needs to disambiguate which one this is.
     */
    seriesId: fk('series_id')
      .references(() => series.id, { onDelete: 'cascade' })
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
    index('episode_progress_user_series_idx').on(table.userId, table.seriesId),
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
    seriesId: fk('series_id')
      .references(() => series.id, { onDelete: 'cascade' })
      .notNull(),

    /** Manual ordering within the list. */
    position: integer('position').notNull().default(0),
    note: varchar('note', { length: 500 }),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('custom_list_items_list_series_key').on(table.listId, table.seriesId),
    index('custom_list_items_order_idx').on(table.listId, table.position),
  ],
);

/**
 * Ratings.
 *
 * `seriesId` and `episodeId` are both nullable with exactly one required, so
 * episode ratings can be added later without a second table or a migration of
 * existing rows. A user rates a series as a whole ("Attack on Titan"), not
 * one of its entries individually.
 */
export const ratings = pgTable(
  'ratings',
  {
    id: primaryId(),
    userId: fk('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    seriesId: fk('series_id').references(() => series.id, { onDelete: 'cascade' }),
    episodeId: fk('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),

    /** 1-10 whole stars. Half-points would invalidate existing data later. */
    score: smallint('score').notNull(),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('ratings_user_series_key')
      .on(table.userId, table.seriesId)
      .where(sql`${table.seriesId} is not null`),
    uniqueIndex('ratings_user_episode_key')
      .on(table.userId, table.episodeId)
      .where(sql`${table.episodeId} is not null`),
    index('ratings_series_idx').on(table.seriesId),
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

    seriesId: fk('series_id').references(() => series.id, { onDelete: 'cascade' }),
    episodeId: fk('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),

    kind: reactionKindEnum('kind').notNull(),

    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('reactions_user_series_kind_key')
      .on(table.userId, table.seriesId, table.kind)
      .where(sql`${table.seriesId} is not null`),
    uniqueIndex('reactions_user_episode_kind_key')
      .on(table.userId, table.episodeId, table.kind)
      .where(sql`${table.episodeId} is not null`),
    index('reactions_series_idx').on(table.seriesId, table.kind),
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

    seriesId: fk('series_id').references(() => series.id, { onDelete: 'cascade' }),
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
    // The comment thread for a series, newest first, excluding removed rows.
    index('comments_series_idx')
      .on(table.seriesId, sql`${table.createdAt} desc`)
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
  series: one(series, { fields: [libraryEntries.seriesId], references: [series.id] }),
}));

export const episodeProgressRelations = relations(episodeProgress, ({ one }) => ({
  user: one(users, { fields: [episodeProgress.userId], references: [users.id] }),
  episode: one(episodes, { fields: [episodeProgress.episodeId], references: [episodes.id] }),
  series: one(series, { fields: [episodeProgress.seriesId], references: [series.id] }),
}));

export const customListsRelations = relations(customLists, ({ one, many }) => ({
  user: one(users, { fields: [customLists.userId], references: [users.id] }),
  items: many(customListItems),
}));

export const customListItemsRelations = relations(customListItems, ({ one }) => ({
  list: one(customLists, { fields: [customListItems.listId], references: [customLists.id] }),
  series: one(series, { fields: [customListItems.seriesId], references: [series.id] }),
}));

export const ratingsRelations = relations(ratings, ({ one }) => ({
  user: one(users, { fields: [ratings.userId], references: [users.id] }),
  series: one(series, { fields: [ratings.seriesId], references: [series.id] }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  user: one(users, { fields: [comments.userId], references: [users.id] }),
  series: one(series, { fields: [comments.seriesId], references: [series.id] }),
  parent: one(comments, { fields: [comments.parentId], references: [comments.id] }),
  replies: many(comments),
}));

export type LibraryEntryRow = typeof libraryEntries.$inferSelect;
export type EpisodeProgressRow = typeof episodeProgress.$inferSelect;
export type CustomListRow = typeof customLists.$inferSelect;
export type RatingRow = typeof ratings.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type CommentLikeRow = typeof commentLikes.$inferSelect;
