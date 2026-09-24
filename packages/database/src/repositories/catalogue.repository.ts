import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  EntryCreateBody,
  EntryEditBody,
  EntryRelationCreateBody,
  EpisodeCreateBody,
  EpisodeEditBody,
  MediaAssetUpsertBody,
  SeriesCreateBody,
  SeriesEditBody,
  UserRole,
} from '@playanime/contracts';
import type { Database } from '../client/index.js';
import {
  entries,
  entryGenres,
  entryOrganizations,
  entryRelations,
  entryTags,
  episodes,
  genres,
  mediaAssets,
  organizations,
  series,
  tags,
} from '../schema/anime.js';
import { catalogueEditProposals, moderationAuditLog } from '../schema/moderation.js';
import { notifications } from '../schema/notifications.js';
import { episodeSources } from '../schema/sources.js';
import { translatorAnime, translatorGroups } from '../schema/translators.js';
import { profiles, users } from '../schema/users.js';

/**
 * Real width/height plus a blurhash placeholder for one image, already
 * computed by the caller before a write reaches this repository.
 *
 * Deliberately NOT computed in here: every method that writes a
 * `media_assets` row runs inside `db.transaction(...)`, and downloading +
 * decoding a remote image is exactly the kind of slow, failure-prone network
 * call that must never happen while a database transaction is held open.
 * The service layer (which already depends on `@playanime/importer`, the
 * only package with `sharp`/`blurhash` as a dependency) resolves this ahead
 * of time and passes the result down — `null` when the fetch/decode failed
 * or was never attempted, matching how these columns already behave when no
 * metadata exists.
 */
export interface ImageAssetMeta {
  readonly width: number;
  readonly height: number;
  readonly blurhash: string;
}

/**
 * Catalogue authoring.
 *
 * Separate from the public read repositories, which serve the public
 * catalogue. Writes have different concerns — slug uniqueness, duplicate
 * detection, attribution — and mixing them would make it easy to reach a
 * write from a read endpoint.
 *
 * The catalogue is `Series -> Entry -> Episode`. A Series is the
 * rateable/listable unit ("Attack on Titan"); an Entry is one watchable
 * release under it (a season, a cour, a movie, an OVA...). Every Entry
 * belongs to exactly one Series.
 */
export class CatalogueRepository {
  constructor(private readonly db: Database) {}

  /* ------------------------------------------------------------------ */
  /* Series                                                              */
  /* ------------------------------------------------------------------ */

  async seriesSlugTaken(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: series.id })
      .from(series)
      .where(eq(series.slug, slug))
      .limit(1);
    return row !== undefined;
  }

  /**
   * Finds series that look like duplicates of a proposed one.
   *
   * Uses the trigram index already on `series.title`, so this is an indexed
   * lookup rather than a scan. Returned as a warning rather than enforced:
   * distinct works genuinely do share titles (a remake, a sequel with the
   * same name), and refusing outright would make legitimate entries
   * impossible.
   */
  async findSimilarTitles(title: string, limit = 5) {
    const rows = await this.db.execute<{
      id: string;
      slug: string;
      title: string;
      format: string | null;
      season_year: number | null;
      similarity: number;
    }>(sql`
      select s.id,
             s.slug,
             s.title,
             e.entry_type::text as format,
             e.airing_year as season_year,
             similarity(s.title, ${title}) as similarity
      from series as s
      left join entries as e on e.series_id = s.id and e.is_main_entry = true and e.deleted_at is null
      where s.deleted_at is null
        and similarity(s.title, ${title}) > 0.4
      order by similarity desc
      limit ${limit}
    `);

    return [...rows];
  }

  /**
   * Creates a series, optionally with its first entry in the same
   * transaction — the common "add anime" case, mirroring the old
   * single-step flow.
   */
  async createSeries(
    slug: string,
    input: SeriesCreateBody,
    attribution: { userId: string; groupId: string | null },
    firstEntryArtworkMeta: { poster: ImageAssetMeta | null; banner: ImageAssetMeta | null } = {
      poster: null,
      banner: null,
    },
  ) {
    return this.db.transaction(async (tx) => {
      const [seriesRow] = await tx
        .insert(series)
        .values({
          slug,
          title: input.title,
          synopsis: input.synopsis ?? null,
          posterUrl: input.posterUrl ?? null,
          bannerUrl: input.bannerUrl ?? null,
          franchiseId: input.franchiseId ?? null,
        })
        .returning({ id: series.id, slug: series.slug });

      if (seriesRow === undefined) throw new Error('Series insert returned no row.');

      if (input.firstEntry === undefined) {
        return { series: seriesRow, entry: null };
      }

      const entrySlug = 'main';
      const entryRow = await this.insertEntry(
        tx,
        seriesRow.id,
        entrySlug,
        input.firstEntry,
        attribution,
        firstEntryArtworkMeta,
      );

      // A series created without its own explicit poster/banner (the
      // common case — the create form has one shared image field that
      // fills both) inherits its default entry's art, so the catalogue
      // card is never blank just because the caller only thought to
      // supply an entry-level image.
      if (input.posterUrl === undefined || input.bannerUrl === undefined) {
        await tx
          .update(series)
          .set({
            ...(input.posterUrl === undefined ? { posterUrl: input.firstEntry.posterUrl ?? null } : {}),
            ...(input.bannerUrl === undefined ? { bannerUrl: input.firstEntry.bannerUrl ?? null } : {}),
          })
          .where(eq(series.id, seriesRow.id));
      }

      return { series: seriesRow, entry: entryRow };
    });
  }

  async updateSeries(seriesId: string, input: SeriesEditBody) {
    const patch = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.synopsis === undefined ? {} : { synopsis: input.synopsis }),
      ...(input.posterUrl === undefined ? {} : { posterUrl: input.posterUrl }),
      ...(input.bannerUrl === undefined ? {} : { bannerUrl: input.bannerUrl }),
      ...(input.franchiseId === undefined ? {} : { franchiseId: input.franchiseId }),
    };

    if (Object.keys(patch).length === 0) return { id: seriesId };

    const [row] = await this.db
      .update(series)
      .set(patch)
      .where(eq(series.id, seriesId))
      .returning({ id: series.id, slug: series.slug });

    return row ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Entries                                                             */
  /* ------------------------------------------------------------------ */

  /** Existence check by id — same shape as `AnimeRepository.findById`, but for one release rather than the series. */
  async findEntryById(entryId: string) {
    const [row] = await this.db
      .select({ id: entries.id, seriesId: entries.seriesId, slug: entries.slug, title: entries.titleRomaji })
      .from(entries)
      .where(and(eq(entries.id, entryId), isNull(entries.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Existence check by AniList id — backs AniList-first creation flows (the
   * "add anime" autofill picker's own create call already sets `anilistId`,
   * and a bulk importer needs the same check to stay idempotent rather than
   * relying only on the `entries_anilist_id_key` unique index rejecting a
   * duplicate insert after the fact).
   */
  async findEntryByAnilistId(anilistId: number) {
    const [row] = await this.db
      .select({
        id: entries.id,
        seriesId: entries.seriesId,
        slug: entries.slug,
        seriesSlug: series.slug,
      })
      .from(entries)
      .innerJoin(series, eq(series.id, entries.seriesId))
      .where(and(eq(entries.anilistId, anilistId), isNull(entries.deletedAt), isNull(series.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Every series with an AniList-linked main entry — what the periodic
   * `anilistScore` resync (see `catalogue.service.ts`'s
   * `resyncAnilistScores`) iterates over. Scoped to the MAIN entry
   * specifically: a series with several entries (seasons, an OVA, ...)
   * still gets exactly one AniList score, matching how `averageRating`
   * itself is a series-level, not entry-level, aggregate.
   */
  async listSeriesWithAnilistId(): Promise<{ seriesId: string; anilistId: number }[]> {
    const rows = await this.db
      .select({ seriesId: series.id, anilistId: entries.anilistId })
      .from(series)
      .innerJoin(
        entries,
        and(eq(entries.seriesId, series.id), eq(entries.isMainEntry, true), isNull(entries.deletedAt)),
      )
      .where(and(isNull(series.deletedAt), sql`${entries.anilistId} is not null`));

    // The inner join's `and(entries.anilistId is not null)` above already
    // guarantees this at the SQL level; the filter/cast here is just to
    // give TypeScript the non-null type without an unsound assertion.
    return rows.filter((row): row is { seriesId: string; anilistId: number } => row.anilistId !== null);
  }

  /** Writes the AniList score resync computed — never touches `averageRating`, PlayAnime's own separate user-rating aggregate. See `series.anilistScore`'s own schema doc comment for why the two must never be the same column again. */
  async updateAnilistScore(seriesId: string, anilistScore: string | null): Promise<void> {
    await this.db.update(series).set({ anilistScore }).where(eq(series.id, seriesId));
  }

  async entrySlugTaken(seriesId: string, slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: entries.id })
      .from(entries)
      .where(and(eq(entries.seriesId, seriesId), eq(entries.slug, slug)))
      .limit(1);
    return row !== undefined;
  }

  /**
   * Creates an entry with its genres, studios and artwork.
   *
   * One transaction: an entry that committed without its genres would be
   * invisible to every filtered listing, and fixing it means knowing it
   * happened.
   */
  async createEntry(
    seriesId: string,
    slug: string,
    input: EntryCreateBody,
    attribution: { userId: string; groupId: string | null },
    artworkMeta: { poster: ImageAssetMeta | null; banner: ImageAssetMeta | null } = {
      poster: null,
      banner: null,
    },
  ) {
    return this.db.transaction((tx) =>
      this.insertEntry(tx, seriesId, slug, input, attribution, artworkMeta),
    );
  }

  private async insertEntry(
    tx: Database,
    seriesId: string,
    slug: string,
    input: EntryCreateBody,
    attribution: { userId: string; groupId: string | null },
    artworkMeta: { poster: ImageAssetMeta | null; banner: ImageAssetMeta | null },
  ) {
    const [row] = await tx
      .insert(entries)
      .values({
        seriesId,
        slug,
        entryType: input.entryType,
        titleRomaji: input.titleRomaji,
        titleEnglish: input.titleEnglish ?? null,
        titleNative: input.titleNative ?? null,
        synopsis: input.synopsis ?? null,
        status: input.status ?? 'not_yet_released',
        seasonNumber: input.seasonNumber ?? null,
        courNumber: input.courNumber ?? null,
        airingSeason: input.airingSeason ?? null,
        airingYear: input.airingYear ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        episodeCount: input.episodeCount ?? null,
        durationMinutes: input.durationMinutes ?? null,
        ageRating: input.ageRating ?? null,
        isAdult: input.isAdult ?? false,
        releaseOrder: input.releaseOrder ?? null,
        chronologicalOrder: input.chronologicalOrder ?? null,
        isMainEntry: input.isMainEntry ?? true,
        // Set when this entry was created via the AniList autofill picker
        // — links the row to that entry so it can be re-synced later (see
        // CatalogueRepository.syncFromAniList) instead of only rows the
        // bulk importer CLI creates having one.
        anilistId: input.anilistId ?? null,
        malId: input.malId ?? null,
        createdByUserId: attribution.userId,
        createdByGroupId: attribution.groupId,
      })
      .returning({ id: entries.id, slug: entries.slug });

    if (row === undefined) throw new Error('Entry insert returned no row.');

    await this.applyGenres(tx, row.id, input.genres ?? []);
    await this.applyStudios(tx, row.id, input.studios ?? []);
    await this.applyTags(tx, row.id, input.tags ?? []);
    await this.applyArtwork(
      tx,
      row.id,
      input.posterUrl ?? null,
      input.bannerUrl ?? null,
      undefined,
      artworkMeta,
    );

    /*
     * An entry created on a group's behalf is also the group's first claim
     * on it — otherwise `created_by_group_id` records who is answerable
     * for the entry, but the group's own page has no way to know it
     * exists, since that page reads the separate `translator_anime` claim
     * table.
     */
    if (attribution.groupId !== null) {
      await tx.insert(translatorAnime).values({
        groupId: attribution.groupId,
        entryId: row.id,
      });

      await tx
        .update(translatorGroups)
        .set({
          entryCount: sql`(select count(*) from ${translatorAnime} where ${translatorAnime.groupId} = ${attribution.groupId})`,
        })
        .where(eq(translatorGroups.id, attribution.groupId));
    }

    return row;
  }

  async updateEntry(
    entryId: string,
    input: EntryEditBody,
    artworkMeta: { poster: ImageAssetMeta | null; banner: ImageAssetMeta | null } = {
      poster: null,
      banner: null,
    },
  ) {
    return this.db.transaction(async (tx) => {
      const patch = {
        ...(input.entryType === undefined ? {} : { entryType: input.entryType }),
        ...(input.titleRomaji === undefined ? {} : { titleRomaji: input.titleRomaji }),
        ...(input.titleEnglish === undefined ? {} : { titleEnglish: input.titleEnglish }),
        ...(input.titleNative === undefined ? {} : { titleNative: input.titleNative }),
        ...(input.synopsis === undefined ? {} : { synopsis: input.synopsis }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.seasonNumber === undefined ? {} : { seasonNumber: input.seasonNumber }),
        ...(input.courNumber === undefined ? {} : { courNumber: input.courNumber }),
        ...(input.airingSeason === undefined ? {} : { airingSeason: input.airingSeason }),
        ...(input.airingYear === undefined ? {} : { airingYear: input.airingYear }),
        ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
        ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
        ...(input.episodeCount === undefined ? {} : { episodeCount: input.episodeCount }),
        ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
        ...(input.ageRating === undefined ? {} : { ageRating: input.ageRating }),
        ...(input.isAdult === undefined ? {} : { isAdult: input.isAdult }),
        ...(input.releaseOrder === undefined ? {} : { releaseOrder: input.releaseOrder }),
        ...(input.chronologicalOrder === undefined ? {} : { chronologicalOrder: input.chronologicalOrder }),
        ...(input.isMainEntry === undefined ? {} : { isMainEntry: input.isMainEntry }),
      };

      if (Object.keys(patch).length > 0) {
        await tx.update(entries).set(patch).where(eq(entries.id, entryId));
      }

      if (input.genres !== undefined) await this.applyGenres(tx, entryId, input.genres);
      if (input.studios !== undefined) await this.applyStudios(tx, entryId, input.studios);
      if (input.tags !== undefined) await this.applyTags(tx, entryId, input.tags);

      if (input.posterUrl !== undefined || input.bannerUrl !== undefined) {
        await this.applyArtwork(
          tx,
          entryId,
          input.posterUrl ?? null,
          input.bannerUrl ?? null,
          { posterProvided: input.posterUrl !== undefined, bannerProvided: input.bannerUrl !== undefined },
          artworkMeta,
        );
      }

      const [row] = await tx
        .select({ id: entries.id, slug: entries.slug })
        .from(entries)
        .where(eq(entries.id, entryId))
        .limit(1);

      return row ?? null;
    });
  }

  /**
   * Every entry under a series, in release order (falling back to airing
   * date) — the season/extras breakdown returned inline with series
   * detail, so the detail page never needs a second round trip per entry.
   */
  listEntriesForSeries(seriesId: string) {
    return this.db
      .select({
        id: entries.id,
        slug: entries.slug,
        entryType: entries.entryType,
        titleRomaji: entries.titleRomaji,
        titleEnglish: entries.titleEnglish,
        titleNative: entries.titleNative,
        seasonNumber: entries.seasonNumber,
        courNumber: entries.courNumber,
        airingSeason: entries.airingSeason,
        airingYear: entries.airingYear,
        status: entries.status,
        episodeCount: entries.episodeCount,
        releaseOrder: entries.releaseOrder,
        chronologicalOrder: entries.chronologicalOrder,
        isMainEntry: entries.isMainEntry,
        posterUrl: mediaAssets.url,
        posterBlurhash: mediaAssets.blurhash,
        posterWidth: mediaAssets.width,
        posterHeight: mediaAssets.height,
      })
      .from(entries)
      .leftJoin(
        mediaAssets,
        and(eq(mediaAssets.entryId, entries.id), eq(mediaAssets.kind, 'poster'), eq(mediaAssets.isPrimary, true)),
      )
      .where(and(eq(entries.seriesId, seriesId), isNull(entries.deletedAt)))
      .orderBy(
        sql`${entries.releaseOrder} asc nulls last`,
        sql`${entries.airingYear} asc nulls last`,
        asc(entries.createdAt),
      );
  }

  /**
   * Replaces the genre set, creating genres on demand by name — mirrors
   * `applyTags` now, not the old "reject an unknown slug" behavior:
   * genres were a small hand-curated list matched by slug with an
   * unknown one rejected outright, but a translator can now add a new
   * genre directly while authoring, the same as a tag, so an
   * unrecognized name is created rather than refused.
   */
  private async applyGenres(tx: Database, entryId: string, names: readonly string[]) {
    await tx.delete(entryGenres).where(eq(entryGenres.entryId, entryId));

    if (names.length === 0) return;

    const unique = [...new Set(names)];

    const existing = await tx
      .select({ id: genres.id, name: genres.name })
      .from(genres)
      .where(inArray(genres.name, unique));

    const byName = new Map(existing.map((row) => [row.name, row.id]));
    const toCreate = unique.filter((name) => !byName.has(name));

    if (toCreate.length > 0) {
      const created = await tx
        .insert(genres)
        .values(
          toCreate.map((name) => ({
            slug: name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .slice(0, 64),
            name,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: genres.id, name: genres.name });

      for (const row of created) byName.set(row.name, row.id);

      // A slug collision between two different genre names (rare, but
      // the slugify above is lossy) means onConflictDoNothing silently
      // skipped one — re-select rather than leave it unresolved, same
      // reasoning as applyTags's own re-select.
      const stillMissing = toCreate.filter((name) => !byName.has(name));
      if (stillMissing.length > 0) {
        const rows = await tx
          .select({ id: genres.id, name: genres.name })
          .from(genres)
          .where(inArray(genres.name, stillMissing));
        for (const row of rows) byName.set(row.name, row.id);
      }
    }

    const genreIds = unique.map((name) => byName.get(name)).filter((id): id is string => id !== undefined);
    if (genreIds.length > 0) {
      await tx.insert(entryGenres).values(genreIds.map((genreId) => ({ entryId, genreId }))).onConflictDoNothing();
    }
  }

  /**
   * Replaces the studio set, creating organizations on demand.
   *
   * Studios are free text from the author, unlike genres which come from a
   * fixed taxonomy — there is no useful closed list of animation studios.
   */
  private async applyStudios(tx: Database, entryId: string, names: readonly string[]) {
    await tx
      .delete(entryOrganizations)
      .where(and(eq(entryOrganizations.entryId, entryId), eq(entryOrganizations.role, 'studio')));

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
        .insert(entryOrganizations)
        .values({
          entryId,
          organizationId: organization.id,
          role: 'studio',
          // The first listed studio is the primary one, which is what the
          // detail page credits.
          isPrimary: index === 0,
        })
        .onConflictDoNothing();
    }
  }

  /**
   * Replaces the tag set, creating tags on demand by name — mirrors
   * `applyStudios`, not `applyGenres`: tags are AniList's large free-form
   * set, matched and created by `name` the same way an AniList sync's own
   * `resolveOrCreateTaxonomy` does (see `packages/importer/src/taxonomy.ts`'s
   * own doc comment on why name, never `slugify(name)`, is the match key
   * — this app's hand-picked Polish slugs would never match an
   * English-derived one otherwise), so a hand-typed tag this catalogue
   * hasn't seen before is created rather than rejected.
   */
  private async applyTags(tx: Database, entryId: string, names: readonly string[]) {
    await tx.delete(entryTags).where(eq(entryTags.entryId, entryId));

    if (names.length === 0) return;

    const unique = [...new Set(names)];

    const existing = await tx
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(inArray(tags.name, unique));

    const byName = new Map(existing.map((row) => [row.name, row.id]));
    const toCreate = unique.filter((name) => !byName.has(name));

    if (toCreate.length > 0) {
      const created = await tx
        .insert(tags)
        .values(
          toCreate.map((name) => ({
            slug: name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
              .slice(0, 96),
            name,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: tags.id, name: tags.name });

      for (const row of created) byName.set(row.name, row.id);

      // A slug collision between two different tag names (rare, but the
      // slugify above is lossy) means onConflictDoNothing silently skipped
      // one — re-select rather than leave it unresolved, same reasoning
      // as resolveOrCreateTaxonomy's own re-select.
      const stillMissing = toCreate.filter((name) => !byName.has(name));
      if (stillMissing.length > 0) {
        const rows = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.name, stillMissing));
        for (const row of rows) byName.set(row.name, row.id);
      }
    }

    const tagIds = unique.map((name) => byName.get(name)).filter((id): id is string => id !== undefined);
    if (tagIds.length > 0) {
      await tx.insert(entryTags).values(tagIds.map((tagId) => ({ entryId, tagId }))).onConflictDoNothing();
    }
  }

  /** Sets the primary poster and banner on an entry, replacing any existing ones. */
  private async applyArtwork(
    tx: Database,
    entryId: string,
    posterUrl: string | null,
    bannerUrl: string | null,
    provided: { posterProvided: boolean; bannerProvided: boolean } = {
      posterProvided: true,
      bannerProvided: true,
    },
    meta: { poster: ImageAssetMeta | null; banner: ImageAssetMeta | null } = {
      poster: null,
      banner: null,
    },
  ) {
    for (const [kind, url, wasProvided, imageMeta] of [
      ['poster', posterUrl, provided.posterProvided, meta.poster],
      ['banner', bannerUrl, provided.bannerProvided, meta.banner],
    ] as const) {
      if (!wasProvided) continue;

      // A partial unique index allows only one primary asset per kind, so the
      // old one is removed before the new one is written.
      await tx
        .delete(mediaAssets)
        .where(
          and(
            eq(mediaAssets.entryId, entryId),
            eq(mediaAssets.kind, kind),
            eq(mediaAssets.isPrimary, true),
          ),
        );

      if (url === null || url.length === 0) continue;

      await tx.insert(mediaAssets).values({
        entryId,
        kind,
        url,
        isPrimary: true,
        width: imageMeta?.width ?? null,
        height: imageMeta?.height ?? null,
        blurhash: imageMeta?.blurhash ?? null,
      });
    }
  }

  /** Genre ids currently attached to an entry — used to compute what a sync actually adds, not just its full AniList set. */
  async attachedGenreIds(entryId: string): Promise<string[]> {
    const rows = await this.db
      .select({ genreId: entryGenres.genreId })
      .from(entryGenres)
      .where(eq(entryGenres.entryId, entryId));
    return rows.map((row) => row.genreId);
  }

  /** Tag ids currently attached to an entry. Mirrors `attachedGenreIds`. */
  async attachedTagIds(entryId: string): Promise<string[]> {
    const rows = await this.db
      .select({ tagId: entryTags.tagId })
      .from(entryTags)
      .where(eq(entryTags.entryId, entryId));
    return rows.map((row) => row.tagId);
  }

  /** Studio names currently credited on an entry. Mirrors `attachedGenreIds`. */
  async attachedStudioNames(entryId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: organizations.name })
      .from(entryOrganizations)
      .innerJoin(organizations, eq(organizations.id, entryOrganizations.organizationId))
      .where(and(eq(entryOrganizations.entryId, entryId), eq(entryOrganizations.role, 'studio')));
    return rows.map((row) => row.name);
  }

  /**
   * An entry's current state, restricted to exactly the fields
   * `EntryEditBody` can touch — used as the "before" side of an audit diff
   * (see `diffAnimeEdit` in `catalogue.service.ts`). Poster/banner and
   * genre/studio names each need a separate read since they are not columns
   * on `entries` itself.
   */
  async snapshotEntryForDiff(entryId: string) {
    const [row] = await this.db
      .select({
        titleRomaji: entries.titleRomaji,
        titleEnglish: entries.titleEnglish,
        titleNative: entries.titleNative,
        synopsis: entries.synopsis,
        entryType: entries.entryType,
        status: entries.status,
        seasonNumber: entries.seasonNumber,
        courNumber: entries.courNumber,
        airingSeason: entries.airingSeason,
        airingYear: entries.airingYear,
        startDate: entries.startDate,
        endDate: entries.endDate,
        episodeCount: entries.episodeCount,
        durationMinutes: entries.durationMinutes,
        ageRating: entries.ageRating,
        isAdult: entries.isAdult,
      })
      .from(entries)
      .where(eq(entries.id, entryId))
      .limit(1);

    if (row === undefined) return null;

    const [genreRows, studioNames, tagRows, posterAsset, bannerAsset] = await Promise.all([
      this.db
        .select({ name: genres.name })
        .from(entryGenres)
        .innerJoin(genres, eq(genres.id, entryGenres.genreId))
        .where(eq(entryGenres.entryId, entryId)),
      this.attachedStudioNames(entryId),
      this.db
        .select({ name: tags.name })
        .from(entryTags)
        .innerJoin(tags, eq(tags.id, entryTags.tagId))
        .where(eq(entryTags.entryId, entryId)),
      this.db
        .select({ url: mediaAssets.url })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.entryId, entryId), eq(mediaAssets.kind, 'poster'), eq(mediaAssets.isPrimary, true)))
        .limit(1),
      this.db
        .select({ url: mediaAssets.url })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.entryId, entryId), eq(mediaAssets.kind, 'banner'), eq(mediaAssets.isPrimary, true)))
        .limit(1),
    ]);

    return {
      ...row,
      genres: genreRows.map((genre) => genre.name),
      studios: studioNames,
      tags: tagRows.map((tag) => tag.name),
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
  private async addStudios(tx: Database, entryId: string, names: readonly string[]): Promise<void> {
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
        .insert(entryOrganizations)
        .values({ entryId, organizationId: organization.id, role: 'studio', isPrimary: false })
        .onConflictDoNothing();
    }
  }

  /**
   * Links an entry to an AniList entry and applies a sync: sets
   * `anilistId`/`malId`, ADDS (never removes) the given genre/tag ids and
   * studio names, and overwrites the poster/banner unconditionally —
   * unlike `updateEntry`'s `applyGenres`/`applyStudios`, which fully
   * replace, this only ever adds rows to `entryGenres`/`entryTags`/
   * `entryOrganizations` (relying on their own unique indexes +
   * `onConflictDoNothing` for idempotency), so a hand-picked genre/tag/
   * studio AniList doesn't happen to list is never removed by a re-sync.
   */
  async syncFromAniList(
    entryId: string,
    anilistId: number,
    malId: number | null,
    genreIdsToAdd: readonly string[],
    tagIdsToAdd: readonly string[],
    studioNamesToAdd: readonly string[],
    posterUrl: string | null,
    bannerUrl: string | null,
    artworkMeta: { poster: ImageAssetMeta | null; banner: ImageAssetMeta | null } = {
      poster: null,
      banner: null,
    },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(entries).set({ anilistId, malId }).where(eq(entries.id, entryId));

      if (genreIdsToAdd.length > 0) {
        await tx
          .insert(entryGenres)
          .values(genreIdsToAdd.map((genreId) => ({ entryId, genreId })))
          .onConflictDoNothing();
      }

      if (tagIdsToAdd.length > 0) {
        await tx
          .insert(entryTags)
          .values(tagIdsToAdd.map((tagId) => ({ entryId, tagId })))
          .onConflictDoNothing();
      }

      if (studioNamesToAdd.length > 0) {
        await this.addStudios(tx, entryId, studioNamesToAdd);
      }

      await this.applyArtwork(tx, entryId, posterUrl, bannerUrl, undefined, artworkMeta);

      // The series' own poster/banner columns are a separate, series-level
      // default (shown on a catalogue card before any entry is picked) —
      // this sync only ever wrote to the entry's own art, leaving the
      // series with none. Backfilled here, for the main entry only, and
      // only when the series doesn't already have its own image, so a
      // deliberately-set series-level image is never overwritten by a
      // re-sync of its main entry.
      const [entryRow] = await tx
        .select({ seriesId: entries.seriesId, isMainEntry: entries.isMainEntry })
        .from(entries)
        .where(eq(entries.id, entryId))
        .limit(1);

      if (entryRow?.isMainEntry === true) {
        await tx
          .update(series)
          .set({
            ...(posterUrl === null ? {} : { posterUrl: sql`coalesce(${series.posterUrl}, ${posterUrl})` }),
            ...(bannerUrl === null ? {} : { bannerUrl: sql`coalesce(${series.bannerUrl}, ${bannerUrl})` }),
          })
          .where(eq(series.id, entryRow.seriesId));
      }
    });
  }

  async upsertAsset(entryId: string, input: MediaAssetUpsertBody, meta: ImageAssetMeta | null = null) {
    return this.db.transaction(async (tx) => {
      if (input.isPrimary === true) {
        await tx
          .delete(mediaAssets)
          .where(
            and(
              eq(mediaAssets.entryId, entryId),
              eq(mediaAssets.kind, input.kind),
              eq(mediaAssets.isPrimary, true),
            ),
          );
      }

      const [row] = await tx
        .insert(mediaAssets)
        .values({
          entryId,
          kind: input.kind,
          url: input.url,
          isPrimary: input.isPrimary ?? false,
          locale: input.locale ?? null,
          width: meta?.width ?? null,
          height: meta?.height ?? null,
          blurhash: meta?.blurhash ?? null,
        })
        .returning({ id: mediaAssets.id });

      return row ?? null;
    });
  }

  /** Who created an entry, for the authoring views. */
  async attribution(entryId: string) {
    const [row] = await this.db
      .select({
        createdByUsername: users.username,
        createdByGroupName: translatorGroups.name,
        createdAt: entries.createdAt,
        createdByUserId: entries.createdByUserId,
        createdByGroupId: entries.createdByGroupId,
      })
      .from(entries)
      .leftJoin(users, eq(users.id, entries.createdByUserId))
      .leftJoin(translatorGroups, eq(translatorGroups.id, entries.createdByGroupId))
      .where(eq(entries.id, entryId))
      .limit(1);
    return row ?? null;
  }

  /* ------------------------------------------------------------------ */
  /* Entry relations                                                     */
  /* ------------------------------------------------------------------ */

  async createRelation(fromEntryId: string, input: EntryRelationCreateBody) {
    const [row] = await this.db
      .insert(entryRelations)
      .values({
        fromEntryId,
        toEntryId: input.toEntryId,
        relationType: input.relationType,
        // Admin-authored calls only — AniList-sourced edges are only ever
        // written by the sync path, never this repository method.
        source: 'manual',
      })
      .onConflictDoNothing()
      .returning({ id: entryRelations.id });

    return row ?? null;
  }

  async deleteRelation(fromEntryId: string, relationId: string) {
    const [row] = await this.db
      .delete(entryRelations)
      .where(and(eq(entryRelations.id, relationId), eq(entryRelations.fromEntryId, fromEntryId)))
      .returning({ id: entryRelations.id });
    return row ?? null;
  }

  /** Every relation edge touching an entry, in both directions. */
  async listRelationsForEntry(entryId: string) {
    const [outgoing, incoming] = await Promise.all([
      this.db
        .select({
          id: entryRelations.id,
          relationType: entryRelations.relationType,
          source: entryRelations.source,
          otherEntryId: entryRelations.toEntryId,
        })
        .from(entryRelations)
        .where(eq(entryRelations.fromEntryId, entryId)),
      this.db
        .select({
          id: entryRelations.id,
          relationType: entryRelations.relationType,
          source: entryRelations.source,
          otherEntryId: entryRelations.fromEntryId,
        })
        .from(entryRelations)
        .where(eq(entryRelations.toEntryId, entryId)),
    ]);

    return {
      outgoing: outgoing.map((row) => ({ ...row, direction: 'from' as const })),
      incoming: incoming.map((row) => ({ ...row, direction: 'to' as const })),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Episodes                                                            */
  /* ------------------------------------------------------------------ */

  async findEpisode(episodeId: string) {
    const [row] = await this.db
      .select({
        id: episodes.id,
        entryId: episodes.entryId,
        number: episodes.number,
        createdByUserId: episodes.createdByUserId,
        createdByGroupId: episodes.createdByGroupId,
      })
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), isNull(episodes.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /** A user's current role, for the "credit a staff member with no group" check — null for a deleted/unknown user. */
  async findUserRole(userId: string): Promise<UserRole | null> {
    const [row] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    return row?.role ?? null;
  }

  /** Every current moderator/admin, for the "credit a staff member with no group" picker. Username-only — no email, unlike the admin-only user list. */
  async listStaff() {
    return this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: profiles.displayName,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(and(inArray(users.role, ['moderator', 'admin']), isNull(users.deletedAt)))
      .orderBy(asc(users.username));
  }

  /**
   * An episode's current state, restricted to exactly the fields
   * `EpisodeEditBody` can touch — the "before" side of an audit diff, same
   * reasoning as `snapshotEntryForDiff`. `thumbnailUrl` is intentionally
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
        earlyAccessUntil: episodes.earlyAccessUntil,
      })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .limit(1);
    return row ?? null;
  }

  async episodeNumberTaken(entryId: string, number: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(eq(episodes.entryId, entryId), eq(episodes.number, number), isNull(episodes.deletedAt)),
      )
      .limit(1);
    return row !== undefined;
  }

  async createEpisode(
    entryId: string,
    input: EpisodeCreateBody,
    attribution: { userId: string; groupId: string | null },
  ) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(episodes)
        .values({
          entryId,
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
          earlyAccessUntil: input.earlyAccessUntil == null ? null : new Date(input.earlyAccessUntil),
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
    entryId: string,
    from: number,
    to: number,
    durationSeconds: number | null,
    attribution: { userId: string; groupId: string | null },
  ) {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ number: episodes.number })
        .from(episodes)
        .where(and(eq(episodes.entryId, entryId), isNull(episodes.deletedAt)));

      const taken = new Set(existing.map((row) => row.number));
      const skipped: number[] = [];
      const values: (typeof episodes.$inferInsert)[] = [];

      for (let number = from; number <= to; number += 1) {
        if (taken.has(number)) {
          skipped.push(number);
          continue;
        }

        values.push({
          entryId,
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
      ...(input.earlyAccessUntil === undefined
        ? {}
        : { earlyAccessUntil: input.earlyAccessUntil == null ? null : new Date(input.earlyAccessUntil) }),
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
  listEpisodesForEditing(entryId: string) {
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
        earlyAccessUntil: episodes.earlyAccessUntil,
        createdByUserId: episodes.createdByUserId,
        createdByGroupId: episodes.createdByGroupId,
        createdByGroupName: translatorGroups.name,
        createdByGroupSlug: translatorGroups.slug,
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
      .leftJoin(translatorGroups, eq(translatorGroups.id, episodes.createdByGroupId))
      .where(and(eq(episodes.entryId, entryId), isNull(episodes.deletedAt)))
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
      targetType: 'entry' | 'episode';
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
    targetType: 'entry' | 'episode';
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

  /** An entry's own audit trail, covering both the entry row and its episodes. */
  async entryAuditTrail(entryId: string, episodeIds: readonly string[]) {
    const targetIds = [entryId, ...episodeIds];
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
          inArray(moderationAuditLog.targetType, ['entry', 'episode']),
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
export type SeriesEntryRow = Awaited<
  ReturnType<CatalogueRepository['listEntriesForSeries']>
>[number];
