import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { PreferencesUpdateBody, ProfileUpdateBody } from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { anime } from '../schema/anime.js';
import { notifications } from '../schema/notifications.js';
import { comments, follows, libraryEntries, ratings } from '../schema/lists.js';
import { profiles, userPreferences, users } from '../schema/users.js';

export class ProfileRepository {
  constructor(private readonly db: Database) {}

  async findByUsername(username: string, viewerId: string | null) {
    const [row] = await this.db
      .select({
        userId: users.id,
        username: users.username,
        displayName: profiles.displayName,
        bio: profiles.bio,
        avatar: profiles.avatarUrl,
        banner: profiles.bannerUrl,
        followerCount: profiles.followerCount,
        followingCount: profiles.followingCount,
        completedCount: profiles.completedCount,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(and(sql`lower(${users.username}) = lower(${username})`, isNull(users.deletedAt)))
      .limit(1);
    if (row === undefined) return null;
    const [follow] =
      viewerId === null
        ? []
        : await this.db
            .select({ followerId: follows.followerId })
            .from(follows)
            .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, row.userId)))
            .limit(1);
    return { ...row, isFollowedByViewer: follow !== undefined };
  }

  async updateProfile(userId: string, input: ProfileUpdateBody) {
    const [row] = await this.db
      .update(profiles)
      .set({
        displayName: input.displayName,
        bio: input.bio,
        avatarUrl: input.avatar,
        bannerUrl: input.banner,
      })
      .where(eq(profiles.userId, userId))
      .returning();
    return row ?? null;
  }

  async preferences(userId: string) {
    const [row] = await this.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async updatePreferences(userId: string, input: PreferencesUpdateBody) {
    const [row] = await this.db
      .update(userPreferences)
      .set(input)
      .where(eq(userPreferences.userId, userId))
      .returning();
    return row ?? null;
  }

  async follow(followerId: string, followerUsername: string, followingId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(follows)
        .values({ followerId, followingId })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return;
      await Promise.all([
        tx
          .update(profiles)
          .set({ followingCount: sql`${profiles.followingCount} + 1` })
          .where(eq(profiles.userId, followerId)),
        tx
          .update(profiles)
          .set({ followerCount: sql`${profiles.followerCount} + 1` })
          .where(eq(profiles.userId, followingId)),
        tx.insert(notifications).values({
          userId: followingId,
          actorUserId: followerId,
          kind: 'follow',
          title: 'Nowy obserwujący',
          body: `${followerUsername} zaczął Cię obserwować.`,
          href: `/profile/${followerUsername}`,
        }),
      ]);
    });
  }

  async unfollow(followerId: string, followingId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(follows)
        .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
        .returning();
      if (removed.length === 0) return;
      await Promise.all([
        tx
          .update(profiles)
          .set({ followingCount: sql`greatest(${profiles.followingCount} - 1, 0)` })
          .where(eq(profiles.userId, followerId)),
        tx
          .update(profiles)
          .set({ followerCount: sql`greatest(${profiles.followerCount} - 1, 0)` })
          .where(eq(profiles.userId, followingId)),
      ]);
    });
  }

  activity(userId: string, limit: number, before: Date | null) {
    return Promise.all([
      this.db
        .select({
          id: libraryEntries.id,
          animeId: libraryEntries.animeId,
          title: anime.titleRomaji,
          status: libraryEntries.status,
          occurredAt: libraryEntries.updatedAt,
        })
        .from(libraryEntries)
        .innerJoin(anime, eq(anime.id, libraryEntries.animeId))
        .where(
          and(
            eq(libraryEntries.userId, userId),
            eq(libraryEntries.isPrivate, false),
            before === null ? undefined : lt(libraryEntries.updatedAt, before),
          ),
        )
        .orderBy(desc(libraryEntries.updatedAt))
        .limit(limit + 1),
      this.db
        .select({
          id: ratings.id,
          animeId: ratings.animeId,
          title: anime.titleRomaji,
          score: ratings.score,
          occurredAt: ratings.updatedAt,
        })
        .from(ratings)
        .innerJoin(anime, eq(anime.id, ratings.animeId))
        .where(and(eq(ratings.userId, userId), before === null ? undefined : lt(ratings.updatedAt, before)))
        .orderBy(desc(ratings.updatedAt))
        .limit(limit + 1),
      this.db
        .select({
          id: comments.id,
          animeId: comments.animeId,
          title: anime.titleRomaji,
          occurredAt: comments.createdAt,
        })
        .from(comments)
        .innerJoin(anime, eq(anime.id, comments.animeId))
        .where(
          and(
            eq(comments.userId, userId),
            isNull(comments.removedAt),
            before === null ? undefined : lt(comments.createdAt, before),
          ),
        )
        .orderBy(desc(comments.createdAt))
        .limit(limit + 1),
    ]);
  }

  followUsernames(userId: string, relation: 'followers' | 'following', limit: number) {
    return relation === 'followers'
      ? this.db
          .select({ username: users.username })
          .from(follows)
          .innerJoin(users, eq(users.id, follows.followerId))
          .where(eq(follows.followingId, userId))
          .orderBy(desc(follows.createdAt))
          .limit(limit + 1)
      : this.db
          .select({ username: users.username })
          .from(follows)
          .innerJoin(users, eq(users.id, follows.followingId))
          .where(eq(follows.followerId, userId))
          .orderBy(desc(follows.createdAt))
          .limit(limit + 1);
  }
}
