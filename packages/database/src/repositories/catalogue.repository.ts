import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  AnimeCreateBody,
  AnimeEditBody,
  EpisodeCreateBody,
  EpisodeEditBody,
  MediaAssetUpsertBody,
} from '@playanime/contracts';
import type { Database } from '../client/index.js';
import {
  anime,
  animeGenres,
  animeOrganizations,
  animeTags,
  episodes,
  genres,
  mediaAssets,
  organizations,
} from '../schema/anime.js';
import { catalogueEditProposals, moderationAuditLog } from '../schema/moderation.js';
import { notifications } from '../schema/notifications.js';
import { episodeSources } from '../schema/sources.js';
import { translatorAnime, translatorGroups } from '../schema/translators.js';
import { users } from '../schema/users.js';

/**
 * Catalogue authoring.
 *
 * Separate from `AnimeRepository`, which is the read path serving the public
 * catalogue. Writes have different concerns — slug uniqueness, duplicate
 * detection, attribution — and mixing them would make it easy to reach a write
 * from a read endpoint.
 */
export class CatalogueRepository {
  constructor(private readonly db: Database) {}

  /* ------------------------------------------------------------------ */
  /* Titles                                                              */
  /* ------------------------------------------------------------------ */

  async slugTaken(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: anime.id })
      .from(anime)
      .where(eq(anime.slug, slug))
      .limit(1);
    return row !== undefined;
  }

  /**
   * Finds titles that look like duplicates of a proposed one.
   *
   * Uses the trigram index already on `title_romaji`, so this is an indexed
   * lookup rather than a scan. Returned as a warning rather than enforced:
   * distinct works genuinely do share titles (a remake, a sequel with the same
   * name), and refusing outright would make legitimate entries impossible.
   */
  async findSimilarTitles(title: string, limit = 5) {
    const rows = await this.db.execute<{
      id: string;
      slug: string;
      title: string;
      format: string;
      season_year: number | null;
      similarity: number;
    }>(sql`
      select id,
             slug,
             title_romaji as title,
             format::text as format,
             season_year,
             similarity(title_romaji, ${title}) as similarity
      from anime
      where deleted_at is null
        and similarity(title_romaji, ${title}) > 0.4
      order by similarity desc
      limit ${limit}
    `);

    return [...rows];
  }

  /**
   * Creates a title with its genres, studios and artwork.
   *
   * One transaction: a title that committed without its genres would be
   * invisible to every filtered listing, and fixing it means knowing it
   * happened.
   */
  async createAnime(
    slug: string,
    input: AnimeCreateBody,
    attribution: { userId: string; groupId: string | null },
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(anime)
        .values({
          slug,
          titleRomaji: input.titleRomaji,
          titleEnglish: input.titleEnglish ?? null,
          titleNative: input.titleNative ?? null,
          synopsis: input.synopsis ?? null,
          format: input.format,
          status: input.status ?? 'not_yet_released',
          season: input.season ?? null,
          seasonYear: input.seasonYear ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          episodeCount: input.episodeCount ?? null,
          durationMinutes: input.durationMinutes ?? null,
          ageRating: input.ageRating ?? null,
          isAdult: input.isAdult ?? false,
          // Set when this title was created via the AniList autofill
          // picker — links the row to that entry so it can be re-synced
          // later (see CatalogueRepository.syncFromAniList) instead of
          // only rows the bulk importer CLI creates having one.
          anilistId: input.anilistId ?? null,
          createdByUserId: attribution.userId,
          createdByGroupId: attribution.groupId,
        })
        .returning({ id: anime.id, slug: anime.slug });

      if (row === undefined) throw new Error('Anime insert returned no row.');

      await this.applyGenres(tx, row.id, input.genres ?? []);
      await this.applyStudios(tx, row.id, input.studios ?? []);
      await this.applyArtwork(tx, row.id, input.posterUrl ?? null, input.bannerUrl ?? null);

      /*
       * A title created on a group's behalf is also the group's first claim on
       * it — otherwise `created_by_group_id` records who is answerable for the
       * entry, but the group's own page has no way to know it exists, since
       * that page reads the separate `translator_anime` claim table.
       */
      if (attribution.groupId !== null) {
        await tx.insert(translatorAnime).values({
          groupId: attribution.groupId,
          animeId: row.id,
        });

        await tx
          .update(translatorGroups)
          .set({
            animeCount: sql`(select count(*) from ${translatorAnime} where ${translatorAnime.groupId} = ${attribution.groupId})`,
          })
          .where(eq(translatorGroups.id, attribution.groupId));
      }

      return row;
    });
  }

  async updateAnime(animeId: string, input: AnimeEditBody) {
    return this.db.transaction(async (tx) => {
      // Slug is deliberately absent: changing it breaks every existing link,
      // and it is never recomputed from an edited title.
      const patch = {
        ...(input.titleRomaji === undefined ? {} : { titleRomaji: input.titleRomaji }),
        ...(input.titleEnglish === undefined ? {} : { titleEnglish: input.titleEnglish }),
        ...(input.titleNative === undefined ? {} : { titleNative: input.titleNative }),
        ...(input.synopsis === undefined ? {} : { synopsis: input.synopsis }),
        ...(input.format === undefined ? {} : { format: input.format }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.season === undefined ? {} : { season: input.season }),
        ...(input.seasonYear === undefined ? {} : { seasonYear: input.seasonYear }),
        ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
        ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
        ...(input.episodeCount === undefined ? {} : { episodeCount: input.episodeCount }),
        ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
        ...(input.ageRating === undefined ? {} : { ageRating: input.ageRating }),
        ...(input.isAdult === undefined ? {} : { isAdult: input.isAdult }),
      };

      if (Object.keys(patch).length > 0) {
        await tx.update(anime).set(patch).where(eq(anime.id, animeId));
      }

      if (input.genres !== undefined) await this.applyGenres(tx, animeId, input.genres);
      if (input.studios !== undefined) await this.applyStudios(tx, animeId, input.studios);

      if (input.posterUrl !== undefined || input.bannerUrl !== undefined) {
        await this.applyArtwork(
          tx,
          animeId,
          input.posterUrl ?? null,
          input.bannerUrl ?? null,
          { posterProvided: input.posterUrl !== undefined, bannerProvided: input.bannerUrl !== undefined },
        );
      }

      const [row] = await tx
        .select({ id: anime.id, slug: anime.slug })
        .from(anime)
        .where(eq(anime.id, animeId))
        .limit(1);

      return row ?? null;
    });
  }

  /** Replaces the genre set. Unknown slugs are reported, never silently dropped. */
  private async applyGenres(tx: Database, animeId: string, slugs: readonly string[]) {
    await tx.delete(animeGenres).where(eq(animeGenres.animeId, animeId));

    if (slugs.length === 0) return;

    const rows = await tx
      .select({ id: genres.id, slug: genres.slug })
      .from(genres)
      .where(inArray(genres.slug, [...slugs]));

    const known = new Set(rows.map((row) => row.slug));
    const unknown = slugs.filter((slug) => !known.has(slug));
    if (unknown.length > 0) {
      throw new Error(`Unknown genre slugs: ${unknown.join(', ')}`);
    }

    await tx.insert(animeGenres).values(rows.map((row) => ({ animeId, genreId: row.id })));
  }

  /**
   * Replaces the studio set, creating organizations on demand.
   *
   * Studios are free text from the author, unlike genres which come from a
   * fixed taxonomy — there is no useful closed list of animation studios.
   */
  private async applyStudios(tx: Database, animeId: string, names: readonly string[]) {
    await tx
      .delete(animeOrganizations)
      .where(and(eq(animeOrganizations.animeId, animeId), eq(animeOrganizations.role, 'studio')));

    if (names.length === 0) return;

    for (const [index, name] of names.entries()) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 96);

      if (slug.length === 0) continue;

      const [organization] = await tx
        .insert(organizations)
        .values({ slug, name })
        .onConflictDoUpdate({ target: organizations.slug, set: { name } })
        .returning({ id: organizations.id });

      if (organization === undefined) continue;

      await tx
        .insert(animeOrganizations)
        .values({
          animeId,
          organizationId: organization.id,
          role: 'studio',
          // The first listed studio is the primary one, which is what the
          // detail page credits.
          isPrimary: index === 0,
        })
        .onConflictDoNothing();
    }
  }

  /** Sets the primary poster and banner, replacing any existing ones. */
  private async applyArtwork(
    tx: Database,
    animeId: string,
    posterUrl: string | null,
    bannerUrl: string | null,
    provided: { posterProvided: boolean; bannerProvided: boolean } = {
      posterProvided: true,
      bannerProvided: true,
    },
  ) {
    for (const [kind, url, wasProvided] of [
      ['poster', posterUrl, provided.posterProvided],
      ['banner', bannerUrl, provided.bannerProvided],
    ] as const) {
      if (!wasProvided) continue;

      // A partial unique index allows only one primary asset per kind, so the
      // old one is removed before the new one is written.
      await tx
        .delete(mediaAssets)
        .where(
          and(
            eq(mediaAssets.animeId, animeId),
            eq(mediaAssets.kind, kind),
            eq(mediaAssets.isPrimary, true),
          ),
        );

      if (url === null || url.length === 0) continue;

      await tx.insert(mediaAssets).values({ animeId, kind, url, isPrimary: true });
    }
  }

  /** Genre ids currently attached to a title — used to compute what a sync actually adds, not just its full AniList set. */
  async attachedGenreIds(animeId: string): Promise<string[]> {
    const rows = await this.db
      .select({ genreId: animeGenres.genreId })
      .from(animeGenres)
      .where(eq(animeGenres.animeId, animeId));
    return rows.map((row) => row.genreId);
  }

  /** Tag ids currently attached to a title. Mirrors `attachedGenreIds`. */
  async attachedTagIds(animeId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tagId: animeTags.tagId })
      .from(animeTags)
      .where(eq(animeTags.animeId, animeId));
    return rows.map((row) => row.tagId);
  }

  /** Studio names currently credited on a title. Mirrors `attachedGenreIds`. */
  async attachedStudioNames(animeId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: organizations.name })
      .from(animeOrganizations)
      .innerJoin(organizations, eq(organizations.id, animeOrganizations.organizationId))
      .where(and(eq(animeOrganizations.animeId, animeId), eq(animeOrganizations.role, 'studio')));
    return rows.map((row) => row.name);
  }

  /**
   * A title's current state, restricted to exactly the fields
   * `AnimeEditBody` can touch — used as the "before" side of an audit diff
   * (see `diffAnimeEdit` in `catalogue.service.ts`). Poster/banner and
   * genre/studio names each need a separate read since they are not columns
   * on `anime` itself.
   */
  async snapshotAnimeForDiff(animeId: string) {
    const [row] = await this.db
      .select({
        titleRomaji: anime.titleRomaji,
        titleEnglish: anime.titleEnglish,
        titleNative: anime.titleNative,
        synopsis: anime.synopsis,
        format: anime.format,
        status: anime.status,
        season: anime.season,
        seasonYear: anime.seasonYear,
        startDate: anime.startDate,
        endDate: anime.endDate,
        episodeCount: anime.episodeCount,
        durationMinutes: anime.durationMinutes,
        ageRating: anime.ageRating,
        isAdult: anime.isAdult,
      })
      .from(anime)
      .where(eq(anime.id, animeId))
      .limit(1);

    if (row === undefined) return null;

    const [genreRows, studioNames, posterAsset, bannerAsset] = await Promise.all([
      this.db
        .select({ slug: genres.slug })
        .from(animeGenres)
        .innerJoin(genres, eq(genres.id, animeGenres.genreId))
        .where(eq(animeGenres.animeId, animeId)),
      this.attachedStudioNames(animeId),
      this.db
        .select({ url: mediaAssets.url })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.animeId, animeId), eq(mediaAssets.kind, 'poster'), eq(mediaAssets.isPrimary, true)))
        .limit(1),
      this.db
        .select({ url: mediaAssets.url })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.animeId, animeId), eq(mediaAssets.kind, 'banner'), eq(mediaAssets.isPrimary, true)))
        .limit(1),
    ]);

    return {
      ...row,
      genres: genreRows.map((genre) => genre.slug),
      studios: studioNames,
      posterUrl: posterAsset[0]?.url ?? null,
      bannerUrl: bannerAsset[0]?.url ?? null,
    };
  }

  /**
   * Adds studio credits, creating organizations on demand (same
   * slugify-and-upsert-by-slug logic as `applyStudios`) — but additive,
   * never removing an existing credit, matching `syncFromAniList`'s own
   * genre/tag semantics below.
   */
  private async addStudios(tx: Database, animeId: string, names: readonly string[]): Promise<void> {
    for (const name of names) {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 96);

      if (slug.length === 0) continue;

      const [organization] = await tx
        .insert(organizations)
        .values({ slug, name })
        .onConflictDoUpdate({ target: organizations.slug, set: { name } })
        .returning({ id: organizations.id });

      if (organization === undefined) continue;

      await tx
        .insert(animeOrganizations)
        .values({ animeId, organizationId: organization.id, role: 'studio', isPrimary: false })
        .onConflictDoNothing();
    }
  }

  /**
   * Links a title to an AniList entry and applies a sync: sets
   * `anilistId`/`malId`, ADDS (never removes) the given genre/tag ids and
   * studio names, and overwrites the poster/banner unconditionally —
   * unlike `updateAnime`'s `applyGenres`/`applyStudios`, which fully
   * replace, this only ever adds rows to `animeGenres`/`animeTags`/
   * `animeOrganizations` (relying on their own unique indexes +
   * `onConflictDoNothing` for idempotency), so a hand-picked genre/tag/
   * studio AniList doesn't happen to list is never removed by a re-sync.
   */
  async syncFromAniList(
    animeId: string,
    anilistId: number,
    malId: number | null,
    genreIdsToAdd: readonly string[],
    tagIdsToAdd: readonly string[],
    studioNamesToAdd: readonly string[],
    posterUrl: string | null,
    bannerUrl: string | null,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(anime).set({ anilistId, malId }).where(eq(anime.id, animeId));

      if (genreIdsToAdd.length > 0) {
        await tx
          .insert(animeGenres)
          .values(genreIdsToAdd.map((genreId) => ({ animeId, genreId })))
          .onConflictDoNothing();
      }

      if (tagIdsToAdd.length > 0) {
        await tx
          .insert(animeTags)
          .values(tagIdsToAdd.map((tagId) => ({ animeId, tagId })))
          .onConflictDoNothing();
      }

      if (studioNamesToAdd.length > 0) {
        await this.addStudios(tx, animeId, studioNamesToAdd);
      }

      await this.applyArtwork(tx, animeId, posterUrl, bannerUrl);
    });
  }

  async upsertAsset(animeId: string, input: MediaAssetUpsertBody) {
    return this.db.transaction(async (tx) => {
      if (input.isPrimary === true) {
        await tx
          .delete(mediaAssets)
          .where(
            and(
              eq(mediaAssets.animeId, animeId),
              eq(mediaAssets.kind, input.kind),
              eq(mediaAssets.isPrimary, true),
            ),
          );
      }

      const [row] = await tx
        .insert(mediaAssets)
        .values({
          animeId,
          kind: input.kind,
          url: input.url,
          isPrimary: input.isPrimary ?? false,
          locale: input.locale ?? null,
        })
        .returning({ id: mediaAssets.id });

      return row ?? null;
    });
  }

  /** Who created a title, for the authoring views. */
  async attribution(animeId: string) {
    const [row] = await this.db
      .select({
        createdByUsername: users.username,
        createdByGroupName: translatorGroups.name,
        createdAt: anime.createdAt,
        createdByUserId: anime.createdByUserId,
        createdByGroupId: anime.createdByGroupId,
      })
      .from(anime)
      .leftJoin(users, eq(users.id, anime.createdByUserId))
      .leftJoin(translatorGroups, eq(translatorGroups.id, anime.createdByGroupId))
      .where(eq(anime.id, animeId))
      .limit(1);
    return row ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Episodes                                                            */
  /* ------------------------------------------------------------------ */

  async findEpisode(episodeId: string) {
    const [row] = await this.db
      .select({
        id: episodes.id,
        animeId: episodes.animeId,
        number: episodes.number,
        createdByUserId: episodes.createdByUserId,
        createdByGroupId: episodes.createdByGroupId,
      })
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), isNull(episodes.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * An episode's current state, restricted to exactly the fields
   * `EpisodeEditBody` can touch — the "before" side of an audit diff, same
   * reasoning as `snapshotAnimeForDiff`. `thumbnailUrl` is intentionally
   * excluded: unlike `EpisodeCreateBody`, `EpisodeEditBody` does not expose a
   * way to change it, so a proposal/direct edit can never touch it anyway.
   */
  async snapshotEpisodeForDiff(episodeId: string) {
    const [row] = await this.db
      .select({
        number: episodes.number,
        absoluteNumber: episodes.absoluteNumber,
        title: episodes.title,
        synopsis: episodes.synopsis,
        airedAt: episodes.airedAt,
        durationSeconds: episodes.durationSeconds,
        introStartSeconds: episodes.introStartSeconds,
        introEndSeconds: episodes.introEndSeconds,
        outroStartSeconds: episodes.outroStartSeconds,
        isFiller: episodes.isFiller,
        isRecap: episodes.isRecap,
      })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1);
    return row ?? null;
  }

  async episodeNumberTaken(animeId: string, number: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(eq(episodes.animeId, animeId), eq(episodes.number, number), isNull(episodes.deletedAt)),
      )
      .limit(1);
    return row !== undefined;
  }

  async createEpisode(
    animeId: string,
    input: EpisodeCreateBody,
    attribution: { userId: string; groupId: string | null },
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(episodes)
        .values({
          animeId,
          number: input.number,
          absoluteNumber: input.absoluteNumber ?? null,
          title: input.title ?? null,
          synopsis: input.synopsis ?? null,
          airedAt: input.airedAt ?? null,
          durationSeconds: input.durationSeconds ?? null,
          introStartSeconds: input.introStartSeconds ?? null,
          introEndSeconds: input.introEndSeconds ?? null,
          outroStartSeconds: input.outroStartSeconds ?? null,
          isFiller: input.isFiller ?? false,
          isRecap: input.isRecap ?? false,
          createdByUserId: attribution.userId,
          createdByGroupId: attribution.groupId,
        })
        .returning({ id: episodes.id, number: episodes.number });

      if (row === undefined) throw new Error('Episode insert returned no row.');

      if (input.thumbnailUrl != null && input.thumbnailUrl.length > 0) {
        await tx.insert(mediaAssets).values({
          episodeId: row.id,
          kind: 'thumbnail',
          url: input.thumbnailUrl,
          isPrimary: true,
        });
      }

      return row;
    });
  }

  /**
   * Creates a contiguous range of episodes.
   *
   * Existing numbers are skipped rather than failing the batch: re-running a
   * range after adding a few by hand is a normal thing to do, and an
   * all-or-nothing failure would make the feature hostile to use.
   */
  async createEpisodeRange(
    animeId: string,
    from: number,
    to: number,
    durationSeconds: number | null,
    attribution: { userId: string; groupId: string | null },
  ) {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ number: episodes.number })
        .from(episodes)
        .where(and(eq(episodes.animeId, animeId), isNull(episodes.deletedAt)));

      const taken = new Set(existing.map((row) => row.number));
      const skipped: number[] = [];
      const values: (typeof episodes.$inferInsert)[] = [];

      for (let number = from; number <= to; number += 1) {
        if (taken.has(number)) {
          skipped.push(number);
          continue;
        }

        values.push({
          animeId,
          number,
          durationSeconds,
          createdByUserId: attribution.userId,
          createdByGroupId: attribution.groupId,
        });
      }

      if (values.length > 0) await tx.insert(episodes).values(values);

      return { created: values.length, skipped };
    });
  }

  async updateEpisode(episodeId: string, input: EpisodeEditBody) {
    const patch = {
      ...(input.number === undefined ? {} : { number: input.number }),
      ...(input.absoluteNumber === undefined ? {} : { absoluteNumber: input.absoluteNumber }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.synopsis === undefined ? {} : { synopsis: input.synopsis }),
      ...(input.airedAt === undefined ? {} : { airedAt: input.airedAt }),
      ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
      ...(input.introStartSeconds === undefined ? {} : { introStartSeconds: input.introStartSeconds }),
      ...(input.introEndSeconds === undefined ? {} : { introEndSeconds: input.introEndSeconds }),
      ...(input.outroStartSeconds === undefined ? {} : { outroStartSeconds: input.outroStartSeconds }),
      ...(input.isFiller === undefined ? {} : { isFiller: input.isFiller }),
      ...(input.isRecap === undefined ? {} : { isRecap: input.isRecap }),
    };

    if (Object.keys(patch).length === 0) return { id: episodeId };

    const [row] = await this.db
      .update(episodes)
      .set(patch)
      .where(eq(episodes.id, episodeId))
      .returning({ id: episodes.id });

    return row ?? null;
  }

  /**
   * Soft-deletes an episode.
   *
   * Never a hard delete: progress rows, comments and sources all point at it,
   * and removing the row would erase a viewer's watch history.
   */
  async softDeleteEpisode(episodeId: string) {
    const [row] = await this.db
      .update(episodes)
      .set({ deletedAt: new Date() })
      .where(eq(episodes.id, episodeId))
      .returning({ id: episodes.id });
    return row ?? null;
  }

  /** Episodes for an authoring view, with their source counts. */
  listEpisodesForEditing(animeId: string) {
    return this.db
      .select({
        id: episodes.id,
        number: episodes.number,
        title: episodes.title,
        airedAt: episodes.airedAt,
        durationSeconds: episodes.durationSeconds,
        isFiller: episodes.isFiller,
        isRecap: episodes.isRecap,
        introStartSeconds: episodes.introStartSeconds,
        introEndSeconds: episodes.introEndSeconds,
        outroStartSeconds: episodes.outroStartSeconds,
        createdByUserId: episodes.createdByUserId,
        createdByGroupId: episodes.createdByGroupId,
        sourceCount: sql<number>`(
          select count(*)::int from episode_sources as src
          where src.episode_id = ${episodes.id} and src.status = 'active'
        )`,
        pendingSourceCount: sql<number>`(
          select count(*)::int from episode_sources as src
          where src.episode_id = ${episodes.id} and src.status = 'pending'
        )`,
      })
      .from(episodes)
      .where(and(eq(episodes.animeId, animeId), isNull(episodes.deletedAt)))
      .orderBy(asc(episodes.number));
  }

  /* ------------------------------------------------------------------ */
  /* Sources                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Every source on an episode, including rows viewers cannot see.
   *
   * Used by the authoring view, so a submitter can tell why a pending source
   * has not appeared. Never reachable from a public endpoint.
   */
  listSourcesForEditing(episodeId: string) {
    return this.db
      .select({
        id: episodeSources.id,
        provider: episodeSources.provider,
        canonicalUrl: episodeSources.canonicalUrl,
        kind: episodeSources.kind,
        audioLanguage: episodeSources.audioLanguage,
        subtitleLanguage: episodeSources.subtitleLanguage,
        qualityHint: episodeSources.qualityHint,
        isVerified: episodeSources.isVerified,
        availability: episodeSources.availability,
        status: episodeSources.status,
        moderationNote: episodeSources.moderationNote,
        // Ids as well as names: ownership is decided on the id, while the name
        // is only for display. Filtering on a name would be both wrong and a
        // way to see another submitter's rows by matching a display string.
        submittedByUserId: episodeSources.submittedByUserId,
        submittedByGroupId: episodeSources.submittedByGroupId,
        submittedByUsername: users.username,
        groupName: translatorGroups.name,
        createdAt: episodeSources.createdAt,
      })
      .from(episodeSources)
      .leftJoin(users, eq(users.id, episodeSources.submittedByUserId))
      .leftJoin(translatorGroups, eq(translatorGroups.id, episodeSources.submittedByGroupId))
      .where(eq(episodeSources.episodeId, episodeId))
      .orderBy(desc(episodeSources.createdAt));
  }

  async findSource(sourceId: string) {
    const [row] = await this.db
      .select({
        id: episodeSources.id,
        episodeId: episodeSources.episodeId,
        status: episodeSources.status,
        submittedByUserId: episodeSources.submittedByUserId,
        submittedByGroupId: episodeSources.submittedByGroupId,
      })
      .from(episodeSources)
      .where(eq(episodeSources.id, sourceId))
      .limit(1);
    return row ?? null;
  }

  async updateSource(
    sourceId: string,
    input: {
      kind?: (typeof episodeSources.$inferInsert)['kind'];
      audioLanguage?: (typeof episodeSources.$inferInsert)['audioLanguage'];
      subtitleLanguage?: (typeof episodeSources.$inferInsert)['subtitleLanguage'];
      qualityHint?: (typeof episodeSources.$inferInsert)['qualityHint'];
    },
  ) {
    const patch = {
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.audioLanguage === undefined ? {} : { audioLanguage: input.audioLanguage }),
      ...(input.subtitleLanguage === undefined ? {} : { subtitleLanguage: input.subtitleLanguage }),
      ...(input.qualityHint === undefined ? {} : { qualityHint: input.qualityHint }),
    };

    if (Object.keys(patch).length === 0) return { id: sourceId };

    const [row] = await this.db
      .update(episodeSources)
      .set(patch)
      .where(eq(episodeSources.id, sourceId))
      .returning({ id: episodeSources.id });

    return row ?? null;
  }

  /** Withdraws a source its submitter added. The row is retained for audit. */
  async withdrawSource(sourceId: string) {
    const [row] = await this.db
      .update(episodeSources)
      .set({ status: 'removed', moderationNote: 'withdrawn_by_submitter' })
      .where(eq(episodeSources.id, sourceId))
      .returning({ id: episodeSources.id });
    return row ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Cross-group edit proposals                                          */
  /* ------------------------------------------------------------------ */

  /** Creates a pending proposal and notifies the given recipients (the target's owning group leaders, or staff if none). */
  async createProposal(
    input: {
      targetType: 'anime' | 'episode';
      targetId: string;
      proposedByUserId: string;
      proposedByGroupId: string | null;
      changes: Record<string, unknown>;
    },
    notify: { recipientUserIds: readonly string[]; title: string; body: string; href: string },
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(catalogueEditProposals)
        .values({
          targetType: input.targetType,
          targetId: input.targetId,
          proposedByUserId: input.proposedByUserId,
          proposedByGroupId: input.proposedByGroupId,
          changes: input.changes,
        })
        .returning({ id: catalogueEditProposals.id });

      if (row === undefined) throw new Error('Proposal insert returned no row.');

      if (notify.recipientUserIds.length > 0) {
        await tx.insert(notifications).values(
          notify.recipientUserIds.map((userId) => ({
            userId,
            actorUserId: input.proposedByUserId,
            kind: 'moderation' as const,
            title: notify.title,
            body: notify.body,
            href: notify.href,
          })),
        );
      }

      return row;
    });
  }

  async findProposal(proposalId: string) {
    const [row] = await this.db
      .select()
      .from(catalogueEditProposals)
      .where(eq(catalogueEditProposals.id, proposalId))
      .limit(1);
    return row ?? null;
  }

  /** The full staff review queue: every pending proposal, newest first. Never has a decider — it is pending. */
  async listPendingProposals() {
    const proposedByGroup = alias(translatorGroups, 'proposed_by_group');

    return this.db
      .select({
        id: catalogueEditProposals.id,
        targetType: catalogueEditProposals.targetType,
        targetId: catalogueEditProposals.targetId,
        proposedByUsername: users.username,
        proposedByGroupName: proposedByGroup.name,
        changes: catalogueEditProposals.changes,
        status: catalogueEditProposals.status,
        reason: catalogueEditProposals.reason,
        createdAt: catalogueEditProposals.createdAt,
      })
      .from(catalogueEditProposals)
      .leftJoin(users, eq(users.id, catalogueEditProposals.proposedByUserId))
      .leftJoin(proposedByGroup, eq(proposedByGroup.id, catalogueEditProposals.proposedByGroupId))
      .where(eq(catalogueEditProposals.status, 'pending'))
      .orderBy(desc(catalogueEditProposals.createdAt));
  }

  /**
   * Decides a proposal and notifies the proposer either way. Returns null if
   * it was already decided by someone else (a second reviewer racing the
   * first) — the caller applies no catalogue write in that case.
   */
  async decideProposal(
    proposalId: string,
    decidedByUserId: string,
    approve: boolean,
    reason: string | null,
    notify: { title: string; body: string; href: string },
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(catalogueEditProposals)
        .set({
          status: approve ? 'approved' : 'rejected',
          decidedByUserId,
          decidedAt: new Date(),
          reason,
        })
        .where(and(eq(catalogueEditProposals.id, proposalId), eq(catalogueEditProposals.status, 'pending')))
        .returning();

      if (row === undefined) return null;

      await tx.insert(notifications).values({
        userId: row.proposedByUserId,
        actorUserId: decidedByUserId,
        kind: 'moderation',
        title: notify.title,
        body: notify.body,
        href: notify.href,
      });

      return row;
    });
  }

  /**
   * Appends a catalogue-specific audit row, sharing `moderation_audit_log`
   * with the admin module's own writes (same table, same append-only
   * discipline) rather than a parallel log — `changes` carries real
   * before/after values per field, unlike the admin module's older
   * `{ changed: [...] }` writes.
   */
  async writeAuditEntry(entry: {
    action: string;
    actorUserId: string | null;
    targetType: 'anime' | 'episode';
    targetId: string;
    reason: string | null;
    changes: Record<string, { before: unknown; after: unknown }>;
  }): Promise<void> {
    await this.db.insert(moderationAuditLog).values({
      action: entry.action as (typeof moderationAuditLog.$inferInsert)['action'],
      actorUserId: entry.actorUserId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason,
      metadata: { changes: entry.changes },
    });
  }

  /** A title's own audit trail, covering both the anime row and its episodes. */
  async animeAuditTrail(animeId: string, episodeIds: readonly string[]) {
    const targetIds = [animeId, ...episodeIds];
    if (targetIds.length === 0) return [];

    return this.db
      .select({
        id: moderationAuditLog.id,
        action: moderationAuditLog.action,
        targetType: moderationAuditLog.targetType,
        targetId: moderationAuditLog.targetId,
        actorUsername: users.username,
        reason: moderationAuditLog.reason,
        metadata: moderationAuditLog.metadata,
        createdAt: moderationAuditLog.createdAt,
      })
      .from(moderationAuditLog)
      .leftJoin(users, eq(users.id, moderationAuditLog.actorUserId))
      .where(
        and(
          inArray(moderationAuditLog.targetId, targetIds),
          inArray(moderationAuditLog.targetType, ['anime', 'episode']),
        ),
      )
      .orderBy(desc(moderationAuditLog.createdAt));
  }
}

export type EditableEpisodeRow = Awaited<
  ReturnType<CatalogueRepository['listEpisodesForEditing']>
>[number];
export type EditableSourceRow = Awaited<
  ReturnType<CatalogueRepository['listSourcesForEditing']>
>[number];
