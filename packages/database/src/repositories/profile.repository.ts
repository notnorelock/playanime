import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { PreferencesUpdateBody, ProfileUpdateBody } from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { entries, episodes, series } from '../schema/anime.js';
import { notifications } from '../schema/notifications.js';
import { comments, follows, libraryEntries, ratings } from '../schema/lists.js';
import {
  oauthAccounts,
  sessions,
  trustedDevices,
  twoFactorSecrets,
  verificationTokens,
} from '../schema/auth.js';
import { userDevices } from '../schema/devices.js';
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
        pronouns: profiles.pronouns,
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
        pronouns: input.pronouns,
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
          seriesId: series.id,
          seriesSlug: series.slug,
          seriesTitle: series.title,
          status: libraryEntries.status,
          occurredAt: libraryEntries.updatedAt,
        })
        .from(libraryEntries)
        .innerJoin(series, eq(series.id, libraryEntries.seriesId))
        .where(
          and(
            eq(libraryEntries.userId, userId),
            eq(libraryEntries.isPrivate, false),
            isNull(series.deletedAt),
            before === null ? undefined : lt(libraryEntries.updatedAt, before),
          ),
        )
        .orderBy(desc(libraryEntries.updatedAt))
        .limit(limit + 1),
      this.db
        .select({
          id: ratings.id,
          seriesId: series.id,
          seriesSlug: series.slug,
          seriesTitle: series.title,
          score: ratings.score,
          occurredAt: ratings.updatedAt,
        })
        .from(ratings)
        .innerJoin(series, eq(series.id, ratings.seriesId))
        .where(
          and(
            eq(ratings.userId, userId),
            isNull(series.deletedAt),
            before === null ? undefined : lt(ratings.updatedAt, before),
          ),
        )
        .orderBy(desc(ratings.updatedAt))
        .limit(limit + 1),
      // A comment on an episode has no `seriesId` of its own; its title
      // still belongs to a series, reached through episode -> entry.
      this.db
        .select({
          id: comments.id,
          seriesId: series.id,
          seriesSlug: series.slug,
          seriesTitle: series.title,
          occurredAt: comments.createdAt,
        })
        .from(comments)
        .leftJoin(episodes, eq(episodes.id, comments.episodeId))
        .leftJoin(entries, eq(entries.id, episodes.entryId))
        .innerJoin(series, eq(series.id, sql`coalesce(${comments.seriesId}, ${entries.seriesId})`))
        .where(
          and(
            eq(comments.userId, userId),
            isNull(comments.removedAt),
            isNull(series.deletedAt),
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

  /** For the delete-account confirmation step — null for an OAuth-only account with no password set. */
  async passwordHash(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.passwordHash ?? null;
  }

  /**
   * Deletes an account: self-service, so only the account row and its own
   * credentials/sessions/devices are touched, not anything the user
   * created or contributed elsewhere. Comments, ratings, library entries,
   * catalogue attribution — all of it is intentionally left exactly as it
   * is, now under an anonymized identity.
   *
   * A soft delete (`deletedAt`), not a real `DELETE FROM users`: this
   * repository's own `onDelete: 'cascade'` foreign keys would otherwise
   * wipe every comment, rating, and library entry the account ever left —
   * a real `DELETE` here is a much larger blast radius than "close this
   * account" is supposed to have. `deletedAt` is already the mechanism
   * login and session validation check (`packages/auth`), so this reuses
   * an existing, already-enforced gate rather than adding a new one.
   *
   * Username and display name are overwritten with a fixed placeholder —
   * not cleared to null — so every existing join that already reads
   * `users.username`/`profiles.displayName` directly (comments, catalogue
   * attribution, the proposal queue, and more) shows "Deleted account"
   * automatically, with no need to special-case a deleted user at each of
   * those many call sites individually. The placeholder username is
   * randomized specifically so the real one is freed for reuse without a
   * future signup ever colliding with it.
   */
  async deleteAccount(userId: string): Promise<void> {
    const placeholderUsername = `deleted-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const placeholderEmail = `${placeholderUsername}@deleted.playani.me`;

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          email: placeholderEmail,
          emailVerifiedAt: null,
          username: placeholderUsername,
          passwordHash: null,
          deletedAt: new Date(),
        })
        .where(eq(users.id, userId));

      await tx
        .update(profiles)
        .set({
          displayName: 'Usunięte konto',
          bio: null,
          pronouns: null,
          avatarUrl: null,
          bannerUrl: null,
        })
        .where(eq(profiles.userId, userId));

      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.delete(oauthAccounts).where(eq(oauthAccounts.userId, userId));
      await tx.delete(twoFactorSecrets).where(eq(twoFactorSecrets.userId, userId));
      await tx.delete(trustedDevices).where(eq(trustedDevices.userId, userId));
      await tx.delete(verificationTokens).where(eq(verificationTokens.userId, userId));
      await tx.delete(userDevices).where(eq(userDevices.userId, userId));
    });
  }
}
