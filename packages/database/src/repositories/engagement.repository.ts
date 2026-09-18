import { and, avg, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type {
  CommentCreateBody,
  CommentUpdateBody,
  ReactionKind,
  ReviewCreateBody,
} from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { entries, episodes, series } from '../schema/anime.js';
import { notifications } from '../schema/notifications.js';
import { commentLikes, comments, ratings, reactions } from '../schema/lists.js';
import { profiles, users } from '../schema/users.js';

export class EngagementRepository {
  constructor(private readonly db: Database) {}

  async seriesExists(seriesId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
      .limit(1);
    return row !== undefined;
  }

  async rating(userId: string, seriesId: string) {
    const [row] = await this.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.seriesId, seriesId)))
      .limit(1);
    return row ?? null;
  }

  async upsertRating(userId: string, seriesId: string, score: number) {
    const [row] = await this.db
      .insert(ratings)
      .values({ userId, seriesId, score })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.seriesId],
        targetWhere: sql`${ratings.seriesId} is not null`,
        set: { score },
      })
      .returning();
    return row ?? null;
  }

  async deleteRating(userId: string, seriesId: string): Promise<void> {
    await this.db.delete(ratings).where(and(eq(ratings.userId, userId), eq(ratings.seriesId, seriesId)));
  }

  async refreshRatingAggregate(seriesId: string): Promise<void> {
    await this.db.execute(sql`
      update ${series}
      set average_rating = aggregate.average, rating_count = aggregate.count
      from (
        select round(avg(${ratings.score})::numeric, 2) as average, count(*)::integer as count
        from ${ratings}
        where ${ratings.seriesId} = ${seriesId}
      ) aggregate
      where ${series.id} = ${seriesId}
    `);
  }

  listComments(seriesId: string, reviewsOnly: boolean, limit: number, before: Date | null) {
    return this.db
      .select({
        id: comments.id,
        userId: comments.userId,
        seriesId: comments.seriesId,
        episodeId: comments.episodeId,
        parentId: comments.parentId,
        body: comments.body,
        rating: comments.rating,
        hasSpoilers: comments.hasSpoilers,
        likeCount: comments.likeCount,
        replyCount: comments.replyCount,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        username: users.username,
        displayName: profiles.displayName,
        avatar: profiles.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          eq(comments.seriesId, seriesId),
          isNull(comments.removedAt),
          reviewsOnly ? sql`${comments.rating} is not null` : isNull(comments.rating),
          reviewsOnly ? isNull(comments.parentId) : undefined,
          before === null ? undefined : lt(comments.createdAt, before),
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(limit + 1);
  }

  async parent(seriesId: string, parentId: string) {
    const [row] = await this.db
      .select({ id: comments.id, userId: comments.userId, rating: comments.rating })
      .from(comments)
      .where(and(eq(comments.id, parentId), eq(comments.seriesId, seriesId), isNull(comments.removedAt)))
      .limit(1);
    return row ?? null;
  }

  async createComment(
    userId: string,
    seriesId: string,
    input: CommentCreateBody,
    parent: { id: string; userId: string; rating: number | null } | null,
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(comments)
        .values({
          userId,
          seriesId,
          parentId: parent?.id ?? null,
          body: input.body,
          hasSpoilers: input.hasSpoilers ?? false,
        })
        .returning({ id: comments.id });
      if (row === undefined) throw new Error('Comment insert returned no row.');
      if (parent !== null) {
        await tx
          .update(comments)
          .set({ replyCount: sql`${comments.replyCount} + 1` })
          .where(eq(comments.id, parent.id));
        if (parent.userId !== userId) {
          await tx.insert(notifications).values({
            userId: parent.userId,
            actorUserId: userId,
            kind: parent.rating === null ? 'comment_reply' : 'review_reply',
            title: 'Nowa odpowiedź',
            body: 'Ktoś odpowiedział na Twój komentarz.',
            href: `/anime/${seriesId}`,
          });
        }
      }
      return row;
    });
  }

  async createReview(userId: string, seriesId: string, input: ReviewCreateBody) {
    const [row] = await this.db
      .insert(comments)
      .values({
        userId,
        seriesId,
        body: input.body,
        rating: input.rating,
        hasSpoilers: input.hasSpoilers ?? false,
      })
      .returning({ id: comments.id });
    return row ?? null;
  }

  async commentOwner(commentId: string) {
    const [row] = await this.db
      .select({ userId: comments.userId })
      .from(comments)
      .where(and(eq(comments.id, commentId), isNull(comments.removedAt)))
      .limit(1);
    return row ?? null;
  }

  async updateComment(commentId: string, input: CommentUpdateBody) {
    const [row] = await this.db
      .update(comments)
      .set(input)
      .where(eq(comments.id, commentId))
      .returning({ id: comments.id });
    return row ?? null;
  }

  async removeComment(commentId: string): Promise<void> {
    await this.db
      .update(comments)
      .set({ removedAt: new Date(), removalReason: 'user_deleted' })
      .where(eq(comments.id, commentId));
  }

  /* ------------------------------------------------------------------ */
  /* Comment likes                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Toggles a like and returns the authoritative count.
   *
   * The membership row and the denormalized counter are written together, so
   * the number a thread renders can never drift from the rows behind it. The
   * insert is conditional on absence, which makes a double-click idempotent
   * rather than a second increment.
   */
  async toggleCommentLike(commentId: string, userId: string) {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ userId: commentLikes.userId })
        .from(commentLikes)
        .where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)))
        .limit(1);

      const liked = existing === undefined;

      if (liked) {
        await tx.insert(commentLikes).values({ commentId, userId }).onConflictDoNothing();
      } else {
        await tx
          .delete(commentLikes)
          .where(and(eq(commentLikes.commentId, commentId), eq(commentLikes.userId, userId)));
      }

      // Recomputed from the table rather than incremented: a count derived from
      // the rows cannot drift, and this runs once per click.
      const [updated] = await tx
        .update(comments)
        .set({
          likeCount: sql`(select count(*) from ${commentLikes} where ${commentLikes.commentId} = ${commentId})`,
        })
        .where(eq(comments.id, commentId))
        .returning({ likeCount: comments.likeCount });

      return { likeCount: updated?.likeCount ?? 0, liked };
    });
  }

  /**
   * Which of these comments the viewer has liked.
   *
   * One query for a whole page: asking per comment would make a thread of
   * twenty comments twenty round trips.
   */
  async likedCommentIds(commentIds: readonly string[], userId: string): Promise<Set<string>> {
    if (commentIds.length === 0) return new Set();

    const rows = await this.db
      .select({ commentId: commentLikes.commentId })
      .from(commentLikes)
      .where(and(eq(commentLikes.userId, userId), inArray(commentLikes.commentId, [...commentIds])));

    return new Set(rows.map((row) => row.commentId));
  }

  /* ------------------------------------------------------------------ */
  /* Episode engagement                                                  */
  /* ------------------------------------------------------------------ */

  /** Resolves an episode and the series it belongs to (through its entry), or null. */
  async findEpisode(episodeId: string) {
    const [row] = await this.db
      .select({ id: episodes.id, entryId: episodes.entryId, seriesId: entries.seriesId })
      .from(episodes)
      .innerJoin(entries, eq(entries.id, episodes.entryId))
      .where(and(eq(episodes.id, episodeId), isNull(episodes.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /** Comments on one episode, threaded the same way title comments are. */
  listEpisodeComments(episodeId: string, limit: number, before: Date | null) {
    return this.db
      .select({
        id: comments.id,
        userId: comments.userId,
        seriesId: comments.seriesId,
        episodeId: comments.episodeId,
        parentId: comments.parentId,
        body: comments.body,
        rating: comments.rating,
        hasSpoilers: comments.hasSpoilers,
        likeCount: comments.likeCount,
        replyCount: comments.replyCount,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
        username: users.username,
        displayName: profiles.displayName,
        avatar: profiles.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          eq(comments.episodeId, episodeId),
          isNull(comments.removedAt),
          before === null ? undefined : lt(comments.createdAt, before),
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(limit + 1);
  }

  async episodeCommentParent(episodeId: string, parentId: string) {
    const [row] = await this.db
      .select({ id: comments.id, userId: comments.userId, rating: comments.rating })
      .from(comments)
      .where(
        and(eq(comments.id, parentId), eq(comments.episodeId, episodeId), isNull(comments.removedAt)),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Creates an episode comment.
   *
   * `seriesId` is denormalized onto the row so a comment can be found by
   * series without joining through episode -> entry — the moderation
   * queue relies on it.
   */
  async createEpisodeComment(
    userId: string,
    episodeId: string,
    seriesId: string,
    input: CommentCreateBody,
    parent: { id: string; userId: string; rating: number | null } | null,
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(comments)
        .values({
          userId,
          seriesId,
          episodeId,
          parentId: parent?.id ?? null,
          body: input.body,
          hasSpoilers: input.hasSpoilers ?? false,
        })
        .returning({ id: comments.id });

      if (row === undefined) throw new Error('Episode comment insert returned no row.');

      if (parent !== null) {
        await tx
          .update(comments)
          .set({ replyCount: sql`${comments.replyCount} + 1` })
          .where(eq(comments.id, parent.id));

        if (parent.userId !== userId) {
          await tx.insert(notifications).values({
            userId: parent.userId,
            actorUserId: userId,
            kind: 'comment_reply',
            title: 'Nowa odpowiedź',
            body: 'Ktoś odpowiedział na Twój komentarz.',
            href: `/watch/${episodeId}`,
          });
        }
      }

      return row;
    });
  }

  /**
   * The episode's average and count, computed on read.
   *
   * Episode ratings are far less numerous than title ratings, so there is no
   * denormalized counter here: an aggregate that cannot drift is worth more
   * than the one query it would save.
   */
  async episodeRatingAggregate(episodeId: string) {
    const [row] = await this.db
      .select({ average: avg(ratings.score), total: count() })
      .from(ratings)
      .where(eq(ratings.episodeId, episodeId));

    const average = row?.average;

    return {
      // avg() comes back as a numeric string, or null when there are no rows.
      average: average === null || average === undefined ? null : Number(average),
      count: row?.total ?? 0,
    };
  }

  async episodeRating(userId: string, episodeId: string) {
    const [row] = await this.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.episodeId, episodeId)))
      .limit(1);
    return row ?? null;
  }

  async upsertEpisodeRating(userId: string, episodeId: string, score: number) {
    const [row] = await this.db
      .insert(ratings)
      .values({ userId, episodeId, score })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.episodeId],
        targetWhere: sql`${ratings.episodeId} is not null`,
        set: { score },
      })
      .returning();
    return row ?? null;
  }

  async deleteEpisodeRating(userId: string, episodeId: string): Promise<void> {
    await this.db
      .delete(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.episodeId, episodeId)));
  }

  /** Reaction totals per kind. Kinds nobody used are simply absent. */
  async episodeReactionCounts(episodeId: string) {
    return this.db
      .select({ kind: reactions.kind, total: count() })
      .from(reactions)
      .where(eq(reactions.episodeId, episodeId))
      .groupBy(reactions.kind);
  }

  async viewerEpisodeReactions(userId: string, episodeId: string) {
    return this.db
      .select({ kind: reactions.kind })
      .from(reactions)
      .where(and(eq(reactions.userId, userId), eq(reactions.episodeId, episodeId)));
  }

  /** Adds the reaction, or removes it when the user already left it. */
  async toggleEpisodeReaction(
    userId: string,
    episodeId: string,
    kind: ReactionKind,
  ): Promise<boolean> {
    const [existing] = await this.db
      .select({ id: reactions.id })
      .from(reactions)
      .where(
        and(
          eq(reactions.userId, userId),
          eq(reactions.episodeId, episodeId),
          eq(reactions.kind, kind),
        ),
      )
      .limit(1);

    if (existing !== undefined) {
      await this.db.delete(reactions).where(eq(reactions.id, existing.id));
      return false;
    }

    await this.db.insert(reactions).values({ userId, episodeId, kind }).onConflictDoNothing();
    return true;
  }
}
