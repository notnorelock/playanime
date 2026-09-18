import { and, count, desc, eq, gte, ilike, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { AdminAnimeUpdateBody, UserRole } from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { anime, episodes } from '../schema/anime.js';
import { episodeSources } from '../schema/sources.js';
import { comments, libraryEntries, ratings } from '../schema/lists.js';
import { moderationAuditLog, reports, userSanctions } from '../schema/moderation.js';
import { notifications } from '../schema/notifications.js';
import { profiles, users } from '../schema/users.js';

/**
 * Staff-only reads and writes.
 *
 * Kept apart from the public repositories rather than adding "include hidden"
 * flags to them: a query that can return a suspended user or a soft-deleted
 * title should live where it is obvious that is what it does, so it cannot be
 * reached by accident from a public endpoint.
 */

/** Escapes a user-supplied term for use in LIKE. */
function likeTerm(search: string): string {
  return `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

/** Notification title for a new sanction, by kind. See `sanctionUser`. */
function sanctionNotificationTitle(kind: string): string {
  switch (kind) {
    case 'warning':
      return 'Otrzymałeś ostrzeżenie';
    case 'mute':
      return 'Wyciszono Twoje konto';
    case 'suspension':
      return 'Zawieszono Twoje konto';
    case 'ban':
      return 'Zablokowano Twoje konto';
    default:
      return 'Nałożono sankcję na Twoje konto';
  }
}

export class AdminRepository {
  constructor(private readonly db: Database) {}

  /* ------------------------------------------------------------------ */
  /* Users                                                               */
  /* ------------------------------------------------------------------ */

  listUsers(
    filters: { search?: string | undefined; role?: UserRole | undefined; suspendedOnly: boolean },
    limit: number,
    before: Date | null,
  ) {
    const conditions: (SQL | undefined)[] = [
      isNull(users.deletedAt),
      filters.role === undefined ? undefined : eq(users.role, filters.role),
      filters.suspendedOnly ? isNotNull(users.suspendedAt) : undefined,
      before === null ? undefined : lt(users.createdAt, before),
    ];

    if (filters.search !== undefined && filters.search.length > 0) {
      const term = likeTerm(filters.search);
      conditions.push(or(ilike(users.username, term), ilike(users.email, term)));
    }

    return this.db
      .select({
        id: users.id,
        email: users.email,
        username: users.username,
        displayName: profiles.displayName,
        avatar: profiles.avatarUrl,
        role: users.role,
        emailVerifiedAt: users.emailVerifiedAt,
        suspendedAt: users.suspendedAt,
        suspendedUntil: users.suspendedUntil,
        suspensionReason: users.suspensionReason,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(users.createdAt))
      .limit(limit + 1);
  }

  async findUser(userId: string) {
    const [row] = await this.db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async findUserByUsername(username: string) {
    const [row] = await this.db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(and(sql`lower(${users.username}) = lower(${username})`, isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async setRole(userId: string, role: UserRole) {
    const [row] = await this.db
      .update(users)
      .set({ role })
      .where(eq(users.id, userId))
      .returning({ id: users.id, role: users.role });
    return row ?? null;
  }

  /**
   * Issues a sanction and mirrors the current state onto the user row.
   *
   * The `users` columns are the fast path read during authentication; the
   * `user_sanctions` row is the history. Both are written together so a session
   * check can never disagree with the record that justifies it.
   */
  async sanctionUser(
    userId: string,
    issuedByUserId: string,
    input: { kind: string; reason: string; expiresAt: Date | null },
  ) {
    return this.db.transaction(async (tx) => {
      const [sanction] = await tx
        .insert(userSanctions)
        .values({
          userId,
          kind: input.kind,
          reason: input.reason,
          expiresAt: input.expiresAt,
          issuedByUserId,
        })
        .returning();

      if (sanction === undefined) throw new Error('Sanction insert returned no row.');

      // A warning is recorded but does not restrict the account; only the
      // blocking kinds touch the session fast path.
      if (input.kind === 'suspension' || input.kind === 'ban') {
        await tx
          .update(users)
          .set({
            suspendedAt: new Date(),
            suspendedUntil: input.expiresAt,
            suspensionReason: input.reason,
          })
          .where(eq(users.id, userId));
      }

      // Matches the inline-insert convention every other notification write
      // site already uses (translator.repository.ts, profile.repository.ts,
      // engagement.repository.ts) — content is Polish at the write site, not
      // localized per-viewer, same as those. `moderation` was defined in
      // NotificationKind from the start but never actually written until now.
      await tx.insert(notifications).values({
        userId,
        actorUserId: issuedByUserId,
        kind: 'moderation',
        title: sanctionNotificationTitle(input.kind),
        body: input.reason,
        href: '/profile/me',
      });

      return sanction;
    });
  }

  /** Lifts every active sanction and clears the suspension fast path. */
  async liftSanctions(userId: string, liftedByUserId: string) {
    return this.db.transaction(async (tx) => {
      await tx
        .update(userSanctions)
        .set({ liftedAt: new Date(), liftedByUserId })
        .where(and(eq(userSanctions.userId, userId), isNull(userSanctions.liftedAt)));

      await tx
        .update(users)
        .set({ suspendedAt: null, suspendedUntil: null, suspensionReason: null })
        .where(eq(users.id, userId));
    });
  }

  /**
   * A user's sanction history. Reused for both the admin console (any
   * `userId`) and the self-view (`GET /profile/me/sanctions`, always
   * called with the caller's own id) — this query has no notion of
   * "admin" vs. "self," the endpoint above it is what scopes access, so
   * one shared method is correct rather than two near-identical ones.
   */
  sanctions(userId: string) {
    const liftedBy = alias(users, 'lifted_by');

    return this.db
      .select({
        id: userSanctions.id,
        userId: userSanctions.userId,
        kind: userSanctions.kind,
        reason: userSanctions.reason,
        expiresAt: userSanctions.expiresAt,
        issuedByUsername: users.username,
        liftedAt: userSanctions.liftedAt,
        liftedByUsername: liftedBy.username,
        createdAt: userSanctions.createdAt,
      })
      .from(userSanctions)
      .leftJoin(users, eq(users.id, userSanctions.issuedByUserId))
      .leftJoin(liftedBy, eq(liftedBy.id, userSanctions.liftedByUserId))
      .where(eq(userSanctions.userId, userId))
      .orderBy(desc(userSanctions.createdAt))
      .limit(50);
  }

  /* ------------------------------------------------------------------ */
  /* Catalogue                                                           */
  /* ------------------------------------------------------------------ */

  listAnime(
    filters: { search?: string | undefined; includeDeleted: boolean },
    limit: number,
    before: Date | null,
  ) {
    const conditions: (SQL | undefined)[] = [
      filters.includeDeleted ? undefined : isNull(anime.deletedAt),
      before === null ? undefined : lt(anime.updatedAt, before),
    ];

    if (filters.search !== undefined && filters.search.length > 0) {
      const term = likeTerm(filters.search);
      conditions.push(
        or(ilike(anime.titleRomaji, term), ilike(anime.titleEnglish, term), ilike(anime.slug, term)),
      );
    }

    return this.db
      .select({
        id: anime.id,
        slug: anime.slug,
        titleRomaji: anime.titleRomaji,
        format: anime.format,
        status: anime.status,
        seasonYear: anime.seasonYear,
        episodeCount: anime.episodeCount,
        isAdult: anime.isAdult,
        deletedAt: anime.deletedAt,
        updatedAt: anime.updatedAt,
        // Correlated subqueries rather than joins: joining both would multiply
        // rows and force a GROUP BY over every selected column.
        /*
         * Correlated subqueries, written as raw SQL with explicit aliases.
         *
         * Drizzle renders `${anime.id}` as a bare `"id"` when `anime` is the
         * only table in the outer FROM. Inside these subqueries that is
         * ambiguous with `episodes.id`, so the correlation is spelled out as
         * `"anime"."id"` instead. Joining these tables in the outer query is not
         * an option: two one-to-many joins would multiply the rows and force a
         * GROUP BY over every selected column.
         */
        actualEpisodeCount: sql<number>`(
          select count(*)::int
          from episodes as ep
          where ep.anime_id = "anime"."id" and ep.deleted_at is null
        )`,
        sourceCount: sql<number>`(
          select count(*)::int
          from episode_sources as src
          join episodes as ep on ep.id = src.episode_id
          where ep.anime_id = "anime"."id"
            and src.status = 'active'
            and ep.deleted_at is null
        )`,
      })
      .from(anime)
      .where(and(...conditions))
      .orderBy(desc(anime.updatedAt))
      .limit(limit + 1);
  }

  async updateAnime(animeId: string, input: AdminAnimeUpdateBody) {
    const [row] = await this.db
      .update(anime)
      .set({
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.isAdult === undefined ? {} : { isAdult: input.isAdult }),
        ...(input.episodeCount === undefined ? {} : { episodeCount: input.episodeCount }),
        ...(input.synopsis === undefined ? {} : { synopsis: input.synopsis }),
      })
      .where(eq(anime.id, animeId))
      .returning({ id: anime.id });
    return row ?? null;
  }

  /** Soft delete, so sources and library entries keep their referent. */
  async setAnimeDeleted(animeId: string, deleted: boolean) {
    const [row] = await this.db
      .update(anime)
      .set({ deletedAt: deleted ? new Date() : null })
      .where(eq(anime.id, animeId))
      .returning({ id: anime.id });
    return row ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Comments                                                            */
  /* ------------------------------------------------------------------ */

  listComments(
    filters: { filter: 'all' | 'reported' | 'removed'; search?: string | undefined },
    limit: number,
    before: Date | null,
  ) {
    // "comments"."id" is spelled out explicitly, not interpolated as
    // `${comments.id}` — that renders as a bare, unqualified "id", which
    // is ambiguous since `reports` (this subquery's own FROM) also has its
    // own "id" column. Postgres resolves an unqualified column to the
    // innermost scope that has it, so the bare form silently compared
    // each report's target against its OWN id and always undercounted —
    // same bug this file's `actualEpisodeCount`/`sourceCount` above already
    // works around the same way, see their doc comment.
    const openReportCount = sql<number>`(
      select count(*)::int from ${reports}
      where ${reports.targetType} = 'comment'
        and ${reports.targetId} = "comments"."id"
        and ${reports.status} in ('open', 'under_review')
    )`;

    const conditions: (SQL | undefined)[] = [
      before === null ? undefined : lt(comments.createdAt, before),
    ];

    if (filters.filter === 'removed') conditions.push(isNotNull(comments.removedAt));
    else if (filters.filter === 'reported') {
      conditions.push(isNull(comments.removedAt));
      conditions.push(sql`${openReportCount} > 0`);
    } else conditions.push(isNull(comments.removedAt));

    if (filters.search !== undefined && filters.search.length > 0) {
      conditions.push(ilike(comments.body, likeTerm(filters.search)));
    }

    return this.db
      .select({
        id: comments.id,
        body: comments.body,
        animeId: comments.animeId,
        animeTitle: anime.titleRomaji,
        episodeId: comments.episodeId,
        authorUserId: comments.userId,
        authorUsername: users.username,
        rating: comments.rating,
        hasSpoilers: comments.hasSpoilers,
        likeCount: comments.likeCount,
        replyCount: comments.replyCount,
        openReportCount,
        removedAt: comments.removedAt,
        removalReason: comments.removalReason,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .leftJoin(anime, eq(anime.id, comments.animeId))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt))
      .limit(limit + 1);
  }

  async setCommentRemoved(
    commentId: string,
    removedByUserId: string | null,
    reason: string | null,
  ) {
    const [row] = await this.db
      .update(comments)
      .set({
        removedAt: reason === null ? null : new Date(),
        removedByUserId: reason === null ? null : removedByUserId,
        removalReason: reason,
      })
      .where(eq(comments.id, commentId))
      .returning({ id: comments.id, userId: comments.userId });
    return row ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Analytics                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Platform totals.
   *
   * Run as one batch of counts. These are exact — the dashboard shows what the
   * tables contain, never an estimate dressed up as a figure.
   */
  async overview(since7: Date, since30: Date) {
    const [
      totalUsers,
      new7,
      new30,
      suspended,
      animeCount,
      episodeCount,
      sourceCount,
      pendingSources,
      openReports,
      removedComments,
      commentCount,
      ratingCount,
      libraryCount,
    ] = await Promise.all([
      this.count(users, isNull(users.deletedAt)),
      this.count(users, and(isNull(users.deletedAt), gte(users.createdAt, since7))),
      this.count(users, and(isNull(users.deletedAt), gte(users.createdAt, since30))),
      this.count(users, and(isNull(users.deletedAt), isNotNull(users.suspendedAt))),
      this.count(anime, isNull(anime.deletedAt)),
      this.count(episodes, isNull(episodes.deletedAt)),
      this.count(episodeSources, eq(episodeSources.status, 'active')),
      this.count(episodeSources, eq(episodeSources.status, 'pending')),
      this.count(reports, sql`${reports.status} in ('open', 'under_review')`),
      this.count(comments, isNotNull(comments.removedAt)),
      this.count(comments, isNull(comments.removedAt)),
      this.count(ratings, undefined),
      this.count(libraryEntries, undefined),
    ]);

    return {
      totalUsers,
      new7,
      new30,
      suspended,
      animeCount,
      episodeCount,
      sourceCount,
      pendingSources,
      openReports,
      removedComments,
      commentCount,
      ratingCount,
      libraryCount,
    };
  }

  /**
   * Counts rows in one table under an optional condition.
   *
   * An explicit `count()` select rather than a helper: the same shape works for
   * every table here, and the aggregate is pushed to Postgres rather than
   * counting rows in the application.
   */
  private async count(table: PgTable, where: SQL | undefined): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(table).where(where);
    return row?.value ?? 0;
  }

  /**
   * Daily counts over a window.
   *
   * `generate_series` supplies the calendar so days with no rows come back as
   * zero. Without it the chart silently closes the gap and a quiet week looks
   * like a busy one.
   */
  async dailySeries(
    table: 'users' | 'comments' | 'sources',
    from: Date,
    to: Date,
  ): Promise<{ date: string; value: number }[]> {
    const source =
      table === 'users'
        ? sql`select created_at from users where deleted_at is null`
        : table === 'comments'
          ? sql`select created_at from comments`
          : sql`select created_at from episode_sources`;

    /*
     * Bound as ISO strings, not as `Date` objects.
     *
     * The postgres driver serializes parameters for a raw `execute` itself and
     * rejects a Date with "the string argument must be of type string". Casting
     * in SQL keeps the values typed on the server side, where the comparison
     * actually happens.
     */
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const rows = await this.db.execute<{ date: string; value: number }>(sql`
      select to_char(day, 'YYYY-MM-DD') as date,
             coalesce(counted.value, 0)::int as value
      from generate_series(
             ${fromIso}::timestamptz::date,
             ${toIso}::timestamptz::date,
             interval '1 day'
           ) as day
      left join (
        select date_trunc('day', created_at)::date as bucket, count(*)::int as value
        from (${source}) as rows
        where created_at >= ${fromIso}::timestamptz
          and created_at < ${toIso}::timestamptz + interval '1 day'
        group by 1
      ) as counted on counted.bucket = day
      order by day asc
    `);

    return [...rows];
  }

  /** Most-added titles in the window, with their current rating. */
  async topAnime(limit: number) {
    return this.db
      .select({
        animeId: anime.id,
        slug: anime.slug,
        title: anime.titleRomaji,
        libraryCount: count(libraryEntries.id),
        averageRating: anime.averageRating,
      })
      .from(libraryEntries)
      .innerJoin(anime, eq(anime.id, libraryEntries.animeId))
      .where(isNull(anime.deletedAt))
      .groupBy(anime.id, anime.slug, anime.titleRomaji, anime.averageRating)
      .orderBy(desc(count(libraryEntries.id)))
      .limit(limit);
  }

  /* ------------------------------------------------------------------ */
  /* Audit                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * Appends an audit row.
   *
   * Every privileged mutation calls this. There is deliberately no update or
   * delete counterpart: the log answers "who did this and why" months later,
   * which it cannot do if entries can be rewritten.
   */
  async audit(entry: {
    action: (typeof moderationAuditLog.$inferInsert)['action'];
    actorUserId: string | null;
    targetType: string;
    targetId: string;
    previousStatus?: string | null;
    newStatus?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    actorIpAddress?: string | null;
  }): Promise<void> {
    await this.db.insert(moderationAuditLog).values({
      action: entry.action,
      actorUserId: entry.actorUserId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      previousStatus: entry.previousStatus ?? null,
      newStatus: entry.newStatus ?? null,
      reason: entry.reason ?? null,
      metadata: entry.metadata ?? {},
      actorIpAddress: entry.actorIpAddress ?? null,
    });
  }
}
