import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { CommentCreateBody, CommentUpdateBody, ReviewCreateBody } from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { anime } from '../schema/anime.js';
import { notifications } from '../schema/notifications.js';
import { comments, ratings } from '../schema/lists.js';
import { profiles, users } from '../schema/users.js';

export class EngagementRepository {
  constructor(private readonly db: Database) {}

  async animeExists(animeId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: anime.id })
      .from(anime)
      .where(and(eq(anime.id, animeId), isNull(anime.deletedAt)))
      .limit(1);
    return row !== undefined;
  }

  async rating(userId: string, animeId: string) {
    const [row] = await this.db
      .select()
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.animeId, animeId)))
      .limit(1);
    return row ?? null;
  }

  async upsertRating(userId: string, animeId: string, score: number) {
    const [row] = await this.db
      .insert(ratings)
      .values({ userId, animeId, score })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.animeId],
        targetWhere: sql`${ratings.animeId} is not null`,
        set: { score },
      })
      .returning();
    return row ?? null;
  }

  async deleteRating(userId: string, animeId: string): Promise<void> {
    await this.db.delete(ratings).where(and(eq(ratings.userId, userId), eq(ratings.animeId, animeId)));
  }

  async refreshRatingAggregate(animeId: string): Promise<void> {
    await this.db.execute(sql`
      update ${anime}
      set average_rating = aggregate.average, rating_count = aggregate.count
      from (
        select round(avg(${ratings.score})::numeric, 2) as average, count(*)::integer as count
        from ${ratings}
        where ${ratings.animeId} = ${animeId}
      ) aggregate
      where ${anime.id} = ${animeId}
    `);
  }

  listComments(animeId: string, reviewsOnly: boolean, limit: number, before: Date | null) {
    return this.db
      .select({
        id: comments.id,
        userId: comments.userId,
        animeId: comments.animeId,
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
          eq(comments.animeId, animeId),
          isNull(comments.removedAt),
          reviewsOnly ? sql`${comments.rating} is not null` : isNull(comments.rating),
          reviewsOnly ? isNull(comments.parentId) : undefined,
          before === null ? undefined : lt(comments.createdAt, before),
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(limit + 1);
  }

  async parent(animeId: string, parentId: string) {
    const [row] = await this.db
      .select({ id: comments.id, userId: comments.userId, rating: comments.rating })
      .from(comments)
      .where(and(eq(comments.id, parentId), eq(comments.animeId, animeId), isNull(comments.removedAt)))
      .limit(1);
    return row ?? null;
  }

  async createComment(
    userId: string,
    animeId: string,
    input: CommentCreateBody,
    parent: { id: string; userId: string; rating: number | null } | null,
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(comments)
        .values({
          userId,
          animeId,
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
            href: `/anime/${animeId}`,
          });
        }
      }
      return row;
    });
  }

  async createReview(userId: string, animeId: string, input: ReviewCreateBody) {
    const [row] = await this.db
      .insert(comments)
      .values({
        userId,
        animeId,
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
}
