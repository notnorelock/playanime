import { and, asc, count, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  TranslatorAnimeUpsertBody,
  TranslatorGroupCreateBody,
  TranslatorGroupUpdateBody,
  TranslatorRole,
} from '@playanime/contracts';
import type { Database } from '../client/index.js';
import { entries, episodes, mediaAssets, series } from '../schema/anime.js';
import { notifications } from '../schema/notifications.js';
import { moderationAuditLog } from '../schema/moderation.js';
import {
  translatorAnime,
  translatorApplications,
  translatorGroups,
  translatorMembers,
} from '../schema/translators.js';
import { profiles, users } from '../schema/users.js';

/** Poster columns, joined the same way the catalogue does. Entry-scoped: a group claims a specific release. */
const entrySelection = {
  entryId: entries.id,
  slug: entries.slug,
  /** The owning series' slug — an entry has no public URL of its own yet, so a credit card links to `/anime/:seriesSlug`. */
  seriesSlug: series.slug,
  titleRomaji: entries.titleRomaji,
  titleEnglish: entries.titleEnglish,
  titleNative: entries.titleNative,
  entryType: entries.entryType,
  releaseStatus: entries.status,
  seasonNumber: entries.seasonNumber,
  courNumber: entries.courNumber,
  airingSeason: entries.airingSeason,
  airingYear: entries.airingYear,
  episodeCount: entries.episodeCount,
  posterUrl: mediaAssets.url,
  posterBlurhash: mediaAssets.blurhash,
  posterWidth: mediaAssets.width,
  posterHeight: mediaAssets.height,
};

/** Rows a live group listing may return. */
const liveGroup = and(isNull(translatorGroups.deletedAt), isNull(translatorGroups.suspendedAt));

export class TranslatorRepository {
  constructor(private readonly db: Database) {}

  /* ------------------------------------------------------------------ */
  /* Groups                                                              */
  /* ------------------------------------------------------------------ */

  list(
    filters: { search?: string | undefined; recruitingOnly: boolean; verifiedOnly: boolean },
    limit: number,
    before: Date | null,
  ) {
    const conditions: (SQL | undefined)[] = [
      liveGroup,
      filters.recruitingOnly ? eq(translatorGroups.isRecruiting, true) : undefined,
      filters.verifiedOnly ? sql`${translatorGroups.verifiedAt} is not null` : undefined,
      before === null ? undefined : lt(translatorGroups.updatedAt, before),
    ];

    if (filters.search !== undefined && filters.search.length > 0) {
      // Escaped so a user searching for "100%" does not match everything.
      const term = `%${filters.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      conditions.push(
        or(ilike(translatorGroups.name, term), ilike(translatorGroups.description, term)),
      );
    }

    return this.db
      .select({
        id: translatorGroups.id,
        slug: translatorGroups.slug,
        name: translatorGroups.name,
        description: translatorGroups.description,
        avatarUrl: translatorGroups.avatarUrl,
        verifiedAt: translatorGroups.verifiedAt,
        isRecruiting: translatorGroups.isRecruiting,
        memberCount: translatorGroups.memberCount,
        entryCount: translatorGroups.entryCount,
        createdAt: translatorGroups.createdAt,
        updatedAt: translatorGroups.updatedAt,
      })
      .from(translatorGroups)
      .where(and(...conditions))
      .orderBy(desc(translatorGroups.updatedAt))
      .limit(limit + 1);
  }

  /**
   * One group by slug.
   *
   * `includeHidden` is for the admin surface only: a suspended or deleted group
   * must stay invisible to the public API, and the flag makes each call site
   * state which it wants rather than defaulting to the permissive case.
   */
  async findBySlug(slug: string, includeHidden = false) {
    const [row] = await this.db
      .select()
      .from(translatorGroups)
      .where(
        and(eq(translatorGroups.slug, slug), includeHidden ? undefined : liveGroup),
      )
      .limit(1);
    return row ?? null;
  }

  async findById(groupId: string, includeHidden = false) {
    const [row] = await this.db
      .select()
      .from(translatorGroups)
      .where(and(eq(translatorGroups.id, groupId), includeHidden ? undefined : liveGroup))
      .limit(1);
    return row ?? null;
  }

  /** True when a group already uses this name, ignoring case. */
  async nameTaken(name: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: translatorGroups.id })
      .from(translatorGroups)
      .where(and(sql`lower(${translatorGroups.name}) = lower(${name})`, isNull(translatorGroups.deletedAt)))
      .limit(1);
    return row !== undefined;
  }

  async slugTaken(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: translatorGroups.id })
      .from(translatorGroups)
      .where(eq(translatorGroups.slug, slug))
      .limit(1);
    return row !== undefined;
  }

  /**
   * Creates a group and makes its creator the first leader.
   *
   * Both writes happen in one transaction: a group that committed without a
   * leader could never be administered, and there is no recovery path for it
   * short of manual SQL.
   */
  async create(creatorUserId: string, slug: string, input: TranslatorGroupCreateBody) {
    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .insert(translatorGroups)
        .values({
          slug,
          name: input.name,
          description: input.description ?? null,
          avatarUrl: input.avatarUrl ?? null,
          bannerUrl: input.bannerUrl ?? null,
          websiteUrl: input.websiteUrl ?? null,
          discordUrl: input.discordUrl ?? null,
          isRecruiting: input.isRecruiting ?? false,
          memberCount: 1,
        })
        .returning();

      if (group === undefined) throw new Error('Translator group insert returned no row.');

      await tx.insert(translatorMembers).values({
        groupId: group.id,
        userId: creatorUserId,
        role: 'leader',
      });

      return group;
    });
  }

  async update(groupId: string, input: TranslatorGroupUpdateBody) {
    const [row] = await this.db
      .update(translatorGroups)
      .set({
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
        ...(input.bannerUrl === undefined ? {} : { bannerUrl: input.bannerUrl }),
        ...(input.websiteUrl === undefined ? {} : { websiteUrl: input.websiteUrl }),
        ...(input.discordUrl === undefined ? {} : { discordUrl: input.discordUrl }),
        ...(input.isRecruiting === undefined ? {} : { isRecruiting: input.isRecruiting }),
      })
      .where(eq(translatorGroups.id, groupId))
      .returning();
    return row ?? null;
  }

  /**
   * Disbands a group. Soft delete on the group row itself, so its name/slug
   * stay reserved and its membership/title-credit history survives — but its
   * `created_by_group_id` attribution on any entry/episode it added is
   * cleared. `entries.createdByGroupId`/`episodes.createdByGroupId` are
   * plain columns without a real foreign key (see that schema's own
   * comment on why — a circular import between anime.ts and
   * translators.ts), so nothing does this automatically the way an
   * `onDelete: 'set null'` FK would; without it, a deleted group's id
   * would dangle on every entry it created, and "added by <group>" would
   * resolve to nothing.
   */
  async softDelete(groupId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(translatorGroups)
        .set({ deletedAt: new Date() })
        .where(eq(translatorGroups.id, groupId));

      await tx
        .update(entries)
        .set({ createdByGroupId: null })
        .where(eq(entries.createdByGroupId, groupId));

      await tx
        .update(episodes)
        .set({ createdByGroupId: null })
        .where(eq(episodes.createdByGroupId, groupId));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Members                                                             */
  /* ------------------------------------------------------------------ */

  members(groupId: string) {
    return this.db
      .select({
        userId: translatorMembers.userId,
        username: users.username,
        displayName: profiles.displayName,
        avatar: profiles.avatarUrl,
        role: translatorMembers.role,
        creditNote: translatorMembers.creditNote,
        joinedAt: translatorMembers.createdAt,
      })
      .from(translatorMembers)
      .innerJoin(users, eq(users.id, translatorMembers.userId))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(and(eq(translatorMembers.groupId, groupId), isNull(users.deletedAt)))
      .orderBy(asc(translatorMembers.createdAt));
  }

  /**
   * Resolves a username to a user for invitation.
   *
   * Case-insensitive, because a leader types the name as they saw it rendered,
   * not as it was stored.
   */
  async findMemberCandidate(username: string) {
    const [row] = await this.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(sql`lower(${users.username}) = lower(${username})`, isNull(users.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async membership(groupId: string, userId: string) {
    const [row] = await this.db
      .select({
        id: translatorMembers.id,
        role: translatorMembers.role,
        creditNote: translatorMembers.creditNote,
      })
      .from(translatorMembers)
      .where(and(eq(translatorMembers.groupId, groupId), eq(translatorMembers.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * How many leaders the group has.
   *
   * Consulted before any demotion or removal: dropping to zero leaders is the
   * one membership change that cannot be undone from inside the product.
   */
  async leaderCount(groupId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(translatorMembers)
      .where(and(eq(translatorMembers.groupId, groupId), eq(translatorMembers.role, 'leader')));
    return row?.value ?? 0;
  }

  /** Every leader's user id — who to notify about something affecting the whole group. */
  async leaderUserIds(groupId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: translatorMembers.userId })
      .from(translatorMembers)
      .where(and(eq(translatorMembers.groupId, groupId), eq(translatorMembers.role, 'leader')));
    return rows.map((row) => row.userId);
  }

  /** Adds a member and keeps the denormalized count in step. */
  async addMember(
    groupId: string,
    userId: string,
    role: TranslatorRole,
    creditNote: string | null,
    invitedByUserId: string | null,
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(translatorMembers)
        .values({ groupId, userId, role, creditNote, invitedByUserId })
        .onConflictDoNothing({
          target: [translatorMembers.groupId, translatorMembers.userId],
        })
        .returning();

      // Nothing inserted means the user was already a member; the count must
      // not be incremented for a row that did not appear.
      if (row === undefined) return null;

      await tx
        .update(translatorGroups)
        .set({ memberCount: sql`${translatorGroups.memberCount} + 1` })
        .where(eq(translatorGroups.id, groupId));

      return row;
    });
  }

  async updateMember(
    groupId: string,
    userId: string,
    input: { role?: TranslatorRole; creditNote?: string | null },
  ) {
    const [row] = await this.db
      .update(translatorMembers)
      .set({
        ...(input.role === undefined ? {} : { role: input.role }),
        ...(input.creditNote === undefined ? {} : { creditNote: input.creditNote }),
      })
      .where(and(eq(translatorMembers.groupId, groupId), eq(translatorMembers.userId, userId)))
      .returning();
    return row ?? null;
  }

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(translatorMembers)
        .where(and(eq(translatorMembers.groupId, groupId), eq(translatorMembers.userId, userId)))
        .returning({ id: translatorMembers.id });

      if (row === undefined) return false;

      // `greatest(..., 0)` guards the counter against ever going negative if a
      // row is removed by some path that did not increment it.
      await tx
        .update(translatorGroups)
        .set({ memberCount: sql`greatest(${translatorGroups.memberCount} - 1, 0)` })
        .where(eq(translatorGroups.id, groupId));

      return true;
    });
  }

  /**
   * Groups the user belongs to, for "my groups" navigation AND for
   * deciding what they may author (`packages/api/src/modules/catalogue/
   * permissions.ts`'s `authoringGroups`). Both `deletedAt` and
   * `suspendedAt` are excluded — a suspended group is exactly the case
   * moderation exists to stop from authoring, so a member of one must
   * not still be able to create or edit titles on its behalf. (Fixed: an
   * earlier version of this query only filtered `deletedAt`, silently
   * contradicting this method's own doc comment.)
   */
  groupsForUser(userId: string) {
    return this.db
      .select({
        id: translatorGroups.id,
        slug: translatorGroups.slug,
        name: translatorGroups.name,
        description: translatorGroups.description,
        avatarUrl: translatorGroups.avatarUrl,
        verifiedAt: translatorGroups.verifiedAt,
        isRecruiting: translatorGroups.isRecruiting,
        memberCount: translatorGroups.memberCount,
        entryCount: translatorGroups.entryCount,
        createdAt: translatorGroups.createdAt,
        role: translatorMembers.role,
      })
      .from(translatorMembers)
      .innerJoin(translatorGroups, eq(translatorGroups.id, translatorMembers.groupId))
      .where(
        and(
          eq(translatorMembers.userId, userId),
          isNull(translatorGroups.deletedAt),
          isNull(translatorGroups.suspendedAt),
        ),
      )
      .orderBy(desc(translatorGroups.updatedAt));
  }

  /* ------------------------------------------------------------------ */
  /* Titles                                                              */
  /* ------------------------------------------------------------------ */

  titles(groupId: string) {
    return this.db
      .select({
        episodeRange: translatorAnime.episodeRange,
        note: translatorAnime.note,
        addedAt: translatorAnime.createdAt,
        ...entrySelection,
      })
      .from(translatorAnime)
      .innerJoin(entries, eq(entries.id, translatorAnime.entryId))
      .innerJoin(series, eq(series.id, entries.seriesId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.entryId, entries.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(and(eq(translatorAnime.groupId, groupId), isNull(entries.deletedAt)))
      .orderBy(desc(translatorAnime.createdAt));
  }

  /** Groups credited on an entry, shown on its page. */
  groupsForAnime(entryId: string) {
    return this.db
      .select({
        id: translatorGroups.id,
        slug: translatorGroups.slug,
        name: translatorGroups.name,
        avatarUrl: translatorGroups.avatarUrl,
        verifiedAt: translatorGroups.verifiedAt,
        episodeRange: translatorAnime.episodeRange,
      })
      .from(translatorAnime)
      .innerJoin(translatorGroups, eq(translatorGroups.id, translatorAnime.groupId))
      .where(and(eq(translatorAnime.entryId, entryId), liveGroup))
      .orderBy(asc(translatorGroups.name));
  }

  async addTitle(groupId: string, input: TranslatorAnimeUpsertBody) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(translatorAnime)
        .values({
          groupId,
          entryId: input.entryId,
          episodeRange: input.episodeRange ?? null,
          note: input.note ?? null,
        })
        .onConflictDoUpdate({
          target: [translatorAnime.groupId, translatorAnime.entryId],
          set: {
            episodeRange: input.episodeRange ?? null,
            note: input.note ?? null,
          },
        })
        .returning();

      if (row === undefined) throw new Error('Translator title upsert returned no row.');

      // Recomputed rather than incremented: an upsert may or may not have added
      // a row, and a count derived from the table cannot drift.
      await tx
        .update(translatorGroups)
        .set({
          entryCount: sql`(select count(*) from ${translatorAnime} where ${translatorAnime.groupId} = ${groupId})`,
        })
        .where(eq(translatorGroups.id, groupId));

      return row;
    });
  }

  async removeTitle(groupId: string, entryId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(translatorAnime)
        .where(and(eq(translatorAnime.groupId, groupId), eq(translatorAnime.entryId, entryId)));

      await tx
        .update(translatorGroups)
        .set({
          entryCount: sql`(select count(*) from ${translatorAnime} where ${translatorAnime.groupId} = ${groupId})`,
        })
        .where(eq(translatorGroups.id, groupId));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Applications                                                        */
  /* ------------------------------------------------------------------ */

  applications(groupId: string, status: string | null, limit: number, before: Date | null) {
    return this.db
      .select({
        id: translatorApplications.id,
        groupId: translatorApplications.groupId,
        groupName: translatorGroups.name,
        groupSlug: translatorGroups.slug,
        userId: translatorApplications.userId,
        username: users.username,
        displayName: profiles.displayName,
        avatar: profiles.avatarUrl,
        message: translatorApplications.message,
        status: translatorApplications.status,
        decidedAt: translatorApplications.decidedAt,
        createdAt: translatorApplications.createdAt,
      })
      .from(translatorApplications)
      .innerJoin(translatorGroups, eq(translatorGroups.id, translatorApplications.groupId))
      .innerJoin(users, eq(users.id, translatorApplications.userId))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          eq(translatorApplications.groupId, groupId),
          status === null ? undefined : eq(translatorApplications.status, status),
          before === null ? undefined : lt(translatorApplications.createdAt, before),
        ),
      )
      .orderBy(desc(translatorApplications.createdAt))
      .limit(limit + 1);
  }

  async findApplication(applicationId: string) {
    const [row] = await this.db
      .select()
      .from(translatorApplications)
      .where(eq(translatorApplications.id, applicationId))
      .limit(1);
    return row ?? null;
  }

  async pendingApplication(groupId: string, userId: string) {
    const [row] = await this.db
      .select({ id: translatorApplications.id })
      .from(translatorApplications)
      .where(
        and(
          eq(translatorApplications.groupId, groupId),
          eq(translatorApplications.userId, userId),
          eq(translatorApplications.status, 'pending'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createApplication(groupId: string, userId: string, message: string | null) {
    const [row] = await this.db
      .insert(translatorApplications)
      .values({ groupId, userId, message })
      .returning();
    return row ?? null;
  }

  /**
   * Records a decision and, on acceptance, adds the member.
   *
   * One transaction: an accepted application that failed to create the
   * membership would leave the applicant told they were accepted while the
   * group never gained them.
   */
  async decideApplication(
    applicationId: string,
    decidedByUserId: string,
    accept: boolean,
    role: TranslatorRole,
    group: { id: string; name: string; slug: string },
    applicantUserId: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [application] = await tx
        .update(translatorApplications)
        .set({
          status: accept ? 'accepted' : 'rejected',
          decidedAt: new Date(),
          decidedByUserId,
        })
        .where(
          and(
            eq(translatorApplications.id, applicationId),
            eq(translatorApplications.status, 'pending'),
          ),
        )
        .returning();

      // Already decided by another leader a moment earlier.
      if (application === undefined) return null;

      if (accept) {
        const [member] = await tx
          .insert(translatorMembers)
          .values({ groupId: group.id, userId: applicantUserId, role, invitedByUserId: decidedByUserId })
          .onConflictDoNothing({ target: [translatorMembers.groupId, translatorMembers.userId] })
          .returning();

        if (member !== undefined) {
          await tx
            .update(translatorGroups)
            .set({ memberCount: sql`${translatorGroups.memberCount} + 1` })
            .where(eq(translatorGroups.id, group.id));
        }
      }

      await tx.insert(notifications).values({
        userId: applicantUserId,
        actorUserId: decidedByUserId,
        kind: 'system',
        title: accept ? 'Dołączono do grupy' : 'Zgłoszenie odrzucone',
        body: accept
          ? `Twoje zgłoszenie do grupy ${group.name} zostało zaakceptowane.`
          : `Twoje zgłoszenie do grupy ${group.name} zostało odrzucone.`,
        href: `/translator/${group.slug}`,
      });

      return application;
    });
  }

  async withdrawApplication(applicationId: string, userId: string) {
    const [row] = await this.db
      .update(translatorApplications)
      .set({ status: 'withdrawn', decidedAt: new Date() })
      .where(
        and(
          eq(translatorApplications.id, applicationId),
          eq(translatorApplications.userId, userId),
          eq(translatorApplications.status, 'pending'),
        ),
      )
      .returning({ id: translatorApplications.id });
    return row ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Administration                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Sets verification and records why, atomically.
   *
   * The state change and its audit row are one transaction. Writing them
   * separately means a failed log leaves a change nobody can account for —
   * which is precisely the situation the audit log exists to prevent.
   */
  async setVerified(
    groupId: string,
    actorUserId: string,
    verified: boolean,
    audit: { previousStatus: string; reason: string; name: string },
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(translatorGroups)
        .set({
          verifiedAt: verified ? new Date() : null,
          verifiedByUserId: verified ? actorUserId : null,
        })
        .where(eq(translatorGroups.id, groupId))
        .returning();

      if (row === undefined) return null;

      await tx.insert(moderationAuditLog).values({
        action: 'verify_translator_group',
        actorUserId,
        targetType: 'translator_group',
        targetId: groupId,
        previousStatus: audit.previousStatus,
        newStatus: verified ? 'verified' : 'unverified',
        reason: audit.reason,
        metadata: { name: audit.name },
      });

      return row;
    });
  }

  /** Suspends or restores a group, with its audit row in the same transaction. */
  async setSuspended(
    groupId: string,
    actorUserId: string,
    reason: string | null,
    audit: { previousStatus: string; reason: string; name: string },
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(translatorGroups)
        .set({
          suspendedAt: reason === null ? null : new Date(),
          suspensionReason: reason,
        })
        .where(eq(translatorGroups.id, groupId))
        .returning();

      if (row === undefined) return null;

      await tx.insert(moderationAuditLog).values({
        action: 'suspend_translator_group',
        actorUserId,
        targetType: 'translator_group',
        targetId: groupId,
        previousStatus: audit.previousStatus,
        newStatus: reason === null ? 'active' : 'suspended',
        reason: audit.reason,
        metadata: { name: audit.name },
      });

      return row;
    });
  }

  /** Total live groups, for the admin overview. */
  async countGroups(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(translatorGroups)
      .where(isNull(translatorGroups.deletedAt));
    return row?.value ?? 0;
  }

  async countPendingApplications(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(translatorApplications)
      .where(eq(translatorApplications.status, 'pending'));
    return row?.value ?? 0;
  }
}

export type TranslatorGroupListRow = Awaited<ReturnType<TranslatorRepository['list']>>[number];
export type TranslatorTitleRow = Awaited<ReturnType<TranslatorRepository['titles']>>[number];
export type TranslatorMemberListRow = Awaited<ReturnType<TranslatorRepository['members']>>[number];
export type AnimeTranslatorGroupRow = Awaited<
  ReturnType<TranslatorRepository['groupsForAnime']>
>[number];
export type TranslatorApplicationListRow = Awaited<
  ReturnType<TranslatorRepository['applications']>
>[number];
