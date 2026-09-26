import { and, asc, desc, eq, gt, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { buildCursorPage, decodeCursor, encodeCursor, type CursorPage } from '@playanime/shared';
import type { AnimeSort, EntryType, RankingPeriod, ReleaseStatus, SeasonOfYear } from '@playanime/contracts';
import type { Database } from '../client/index.js';
import {
  entries,
  entryGenres,
  entryOrganizations,
  entryTags,
  episodes,
  genres,
  mediaAssets,
  organizations,
  series,
  tags,
} from '../schema/anime.js';
import { episodeProgress } from '../schema/lists.js';

/**
 * Series catalogue queries — the public read path.
 *
 * Repositories exist here for the catalogue because its queries are genuinely
 * involved — keyset pagination over several sort orders, artwork joins, genre
 * filtering. Simpler domains do not get a repository; the API module queries
 * Drizzle directly rather than adding a layer that only forwards calls.
 *
 * A catalogue card/detail reads `series` joined to its default (main) entry
 * for format/status/season/episodeCount — the release info shown before any
 * one entry is picked. `CatalogueRepository.listEntriesForSeries` is the
 * separate per-entry breakdown (seasons/extras), returned inline with series
 * detail rather than through this repository.
 */

export interface AnimeListFilters {
  readonly search?: string | undefined;
  readonly genre?: string | undefined;
  readonly tag?: string | undefined;
  readonly entryType?: EntryType | undefined;
  readonly status?: ReleaseStatus | undefined;
  readonly season?: SeasonOfYear | undefined;
  readonly seasonYear?: number | undefined;
  readonly vipOnly?: boolean | undefined;
  readonly sort?: AnimeSort | undefined;
  readonly includeAdult?: boolean | undefined;
}

/** Row shape returned by catalogue queries, before mapping to a DTO. */
export interface AnimeListRow {
  id: string;
  slug: string;
  title: string;
  format: EntryType | null;
  status: ReleaseStatus | null;
  season: SeasonOfYear | null;
  seasonYear: number | null;
  episodeCount: number | null;
  averageRating: string | null;
  anilistScore: string | null;
  popularityScore: number;
  posterUrl: string | null;
  posterBlurhash: string | null;
  posterWidth: number | null;
  posterHeight: number | null;
  /**
   * Only selected by `list()`'s `sort: 'newest'` path — the cursor value
   * `keysetCondition`/`cursorValue` need for that sort. Absent (not just
   * null) for any other query returning this row shape. Typed as `string`,
   * not `Date` — confirmed live that postgres.js deserializes this
   * `greatest(...)` SQL expression's timestamptz result as a plain ISO
   * string, not a `Date` instance, whatever a `sql<T>()` type annotation
   * on the query claims.
   */
  recentActivityAt?: string;
}

export interface AnimeDetailRow extends AnimeListRow {
  synopsis: string | null;
  franchiseId: string | null;
  ratingCount: number;
  isAdult: boolean;
  updatedAt: Date;
  bannerUrl: string | null;
  bannerBlurhash: string | null;
  bannerWidth: number | null;
  bannerHeight: number | null;
}

/**
 * Keyset cursor.
 *
 * Carries the sort value plus the id tiebreaker, so pagination is stable even
 * when many rows share a popularity score or rating.
 */
interface AnimeCursor extends Record<string, string | number> {
  v: string | number;
  id: string;
}

/** The lower bound for a ranking period, or `null` for `'all-time'` (no lower bound at all). */
function periodStart(period: RankingPeriod): Date | null {
  const now = Date.now();
  switch (period) {
    case 'week':
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case 'year':
      return new Date(now - 365 * 24 * 60 * 60 * 1000);
    case 'all-time':
      return null;
  }
}

export class AnimeRepository {
  constructor(private readonly db: Database) {}

  /**
   * Catalogue listing.
   *
   * Fetches `limit + 1` rows so the presence of a further page is known without
   * a second COUNT query.
   */
  async list(
    filters: AnimeListFilters,
    limit: number,
    cursor: string | null,
  ): Promise<CursorPage<AnimeListRow>> {
    const conditions: SQL[] = [isNull(series.deletedAt)];

    if (filters.includeAdult !== true) {
      // isAdult lives on the main entry; a series with no main entry yet
      // (no filters set) is treated as non-adult by default.
      conditions.push(sql`coalesce(${entries.isAdult}, false) = false`);
    }

    if (filters.search !== undefined && filters.search.length > 0) {
      const pattern = `%${filters.search}%`;
      const match = or(
        ilike(series.title, pattern),
        ilike(entries.titleEnglish, pattern),
      );
      if (match !== undefined) conditions.push(match);
    }

    if (filters.entryType !== undefined) conditions.push(eq(entries.entryType, filters.entryType));
    if (filters.status !== undefined) conditions.push(eq(entries.status, filters.status));
    if (filters.season !== undefined) conditions.push(eq(entries.airingSeason, filters.season));
    if (filters.seasonYear !== undefined) conditions.push(eq(entries.airingYear, filters.seasonYear));
    if (filters.vipOnly !== undefined) conditions.push(eq(entries.vipOnly, filters.vipOnly));

    if (filters.genre !== undefined) {
      // EXISTS rather than a join: a join would duplicate rows for titles
      // matching several genres and break the page size.
      conditions.push(
        sql`exists (
          select 1 from ${entryGenres}
          inner join ${genres} on ${genres.id} = ${entryGenres.genreId}
          where ${entryGenres.entryId} = ${entries.id} and ${genres.slug} = ${filters.genre}
        )`,
      );
    }

    if (filters.tag !== undefined) {
      // Mirrors the genre filter above, same EXISTS reasoning.
      conditions.push(
        sql`exists (
          select 1 from ${entryTags}
          inner join ${tags} on ${tags.id} = ${entryTags.tagId}
          where ${entryTags.entryId} = ${entries.id} and ${tags.slug} = ${filters.tag}
        )`,
      );
    }

    const sort = filters.sort ?? 'popularity';
    const decoded = cursor === null ? null : (decodeCursor(cursor) as AnimeCursor | null);

    if (decoded !== null) {
      const keyset = this.keysetCondition(sort, decoded);
      if (keyset !== undefined) conditions.push(keyset);
    }

    const rows = await this.db
      .select({
        id: series.id,
        slug: series.slug,
        title: series.title,
        format: entries.entryType,
        status: entries.status,
        season: entries.airingSeason,
        seasonYear: entries.airingYear,
        episodeCount: entries.episodeCount,
        averageRating: series.averageRating,
        anilistScore: series.anilistScore,
        popularityScore: series.popularityScore,
        // The series' own poster column wins when set; otherwise this falls
        // back to the main entry's own poster asset (blurhash/width/height
        // are asset-only metadata, so they're only available in the
        // fallback case — null when the series column itself is used).
        posterUrl: sql<string | null>`coalesce(${series.posterUrl}, ${mediaAssets.url})`,
        posterBlurhash: sql<string | null>`case when ${series.posterUrl} is null then ${mediaAssets.blurhash} else null end`,
        posterWidth: sql<number | null>`case when ${series.posterUrl} is null then ${mediaAssets.width} else null end`,
        posterHeight: sql<number | null>`case when ${series.posterUrl} is null then ${mediaAssets.height} else null end`,
        // Selected unconditionally (not only when sort === 'newest') to keep
        // one query shape rather than two — the correlated subquery is
        // cheap at this catalogue's real size, and the alternative (a
        // second, near-duplicate SELECT branch) is a worse trade for a
        // value only ever consumed by cursorValue()/keysetCondition() for
        // one sort order.
        recentActivityAt: this.recentActivityAt,
      })
      .from(series)
      // Left join so a series without a main entry yet still appears.
      .leftJoin(entries, and(eq(entries.seriesId, series.id), eq(entries.isMainEntry, true), isNull(entries.deletedAt)))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.entryId, entries.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(and(...conditions))
      .orderBy(...this.orderBy(sort))
      .limit(limit + 1);

    return buildCursorPage(rows, limit, (row) =>
      encodeCursor({ v: this.cursorValue(sort, row), id: row.id }),
    );
  }

  /**
   * Existence check by id.
   *
   * Returns the identifying columns only: callers that need one field to
   * validate a foreign key should not pull a full detail row to get it.
   */
  async findById(seriesId: string) {
    const [row] = await this.db
      .select({ id: series.id, slug: series.slug, title: series.title })
      .from(series)
      .where(and(eq(series.id, seriesId), isNull(series.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /** Full detail for a series page, by slug. */
  async findBySlug(slug: string): Promise<AnimeDetailRow | null> {
    const poster = mediaAssets;

    const [row] = await this.db
      .select({
        id: series.id,
        slug: series.slug,
        title: series.title,
        format: entries.entryType,
        status: entries.status,
        season: entries.airingSeason,
        seasonYear: entries.airingYear,
        episodeCount: entries.episodeCount,
        averageRating: series.averageRating,
        anilistScore: series.anilistScore,
        popularityScore: series.popularityScore,
        synopsis: series.synopsis,
        franchiseId: series.franchiseId,
        ratingCount: series.ratingCount,
        isAdult: sql<boolean>`coalesce(${entries.isAdult}, false)`,
        updatedAt: series.updatedAt,
        seriesBannerUrl: series.bannerUrl,
        // The series' own poster column wins when set; otherwise this
        // falls back to the main entry's own poster asset.
        posterUrl: sql<string | null>`coalesce(${series.posterUrl}, ${poster.url})`,
        posterBlurhash: sql<string | null>`case when ${series.posterUrl} is null then ${poster.blurhash} else null end`,
        posterWidth: sql<number | null>`case when ${series.posterUrl} is null then ${poster.width} else null end`,
        posterHeight: sql<number | null>`case when ${series.posterUrl} is null then ${poster.height} else null end`,
      })
      .from(series)
      .leftJoin(entries, and(eq(entries.seriesId, series.id), eq(entries.isMainEntry, true), isNull(entries.deletedAt)))
      .leftJoin(
        poster,
        and(
          eq(poster.entryId, entries.id),
          eq(poster.kind, 'poster'),
          eq(poster.isPrimary, true),
        ),
      )
      .where(and(eq(series.slug, slug), isNull(series.deletedAt)))
      .limit(1);

    if (row === undefined) return null;

    const [bannerAsset] = await this.db
      .select({
        url: mediaAssets.url,
        blurhash: mediaAssets.blurhash,
        width: mediaAssets.width,
        height: mediaAssets.height,
      })
      .from(mediaAssets)
      .innerJoin(entries, eq(entries.id, mediaAssets.entryId))
      .where(and(eq(entries.seriesId, row.id), eq(entries.isMainEntry, true), eq(mediaAssets.kind, 'banner'), eq(mediaAssets.isPrimary, true)))
      .limit(1);

    const { seriesBannerUrl, ...detail } = row;

    return {
      ...detail,
      bannerUrl: seriesBannerUrl ?? bannerAsset?.url ?? null,
      bannerBlurhash: seriesBannerUrl === null ? (bannerAsset?.blurhash ?? null) : null,
      bannerWidth: seriesBannerUrl === null ? (bannerAsset?.width ?? null) : null,
      bannerHeight: seriesBannerUrl === null ? (bannerAsset?.height ?? null) : null,
    };
  }

  /**
   * Full detail for one entry under a series — verifies the entry
   * actually belongs to that series (via slug) before returning anything,
   * mirroring `episodesForEntry`'s own guard. Used by the detail page's
   * season selector once the viewer picks a non-default entry.
   */
  async findEntryDetail(seriesSlug: string, entryId: string) {
    const [row] = await this.db
      .select({
        id: entries.id,
        seriesId: entries.seriesId,
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
        synopsis: entries.synopsis,
        ageRating: entries.ageRating,
        durationMinutes: entries.durationMinutes,
        startDate: entries.startDate,
        endDate: entries.endDate,
        isAdult: entries.isAdult,
        updatedAt: entries.updatedAt,
        createdByGroupId: entries.createdByGroupId,
        anilistId: entries.anilistId,
        posterUrl: mediaAssets.url,
        posterBlurhash: mediaAssets.blurhash,
        posterWidth: mediaAssets.width,
        posterHeight: mediaAssets.height,
      })
      .from(entries)
      .innerJoin(series, eq(series.id, entries.seriesId))
      .leftJoin(
        mediaAssets,
        and(eq(mediaAssets.entryId, entries.id), eq(mediaAssets.kind, 'poster'), eq(mediaAssets.isPrimary, true)),
      )
      .where(and(eq(entries.id, entryId), eq(series.slug, seriesSlug), isNull(entries.deletedAt), isNull(series.deletedAt)))
      .limit(1);

    if (row === undefined) return null;

    const [bannerAsset, entryGenreRows, studioRows, entryTagRows] = await Promise.all([
      this.db
        .select({ url: mediaAssets.url, blurhash: mediaAssets.blurhash, width: mediaAssets.width, height: mediaAssets.height })
        .from(mediaAssets)
        .where(and(eq(mediaAssets.entryId, entryId), eq(mediaAssets.kind, 'banner'), eq(mediaAssets.isPrimary, true)))
        .limit(1),
      this.db
        .select({ slug: genres.slug, name: genres.name, namePolish: genres.namePolish })
        .from(entryGenres)
        .innerJoin(genres, eq(genres.id, entryGenres.genreId))
        .where(eq(entryGenres.entryId, entryId)),
      this.db
        .select({ slug: organizations.slug, name: organizations.name, isPrimary: entryOrganizations.isPrimary })
        .from(entryOrganizations)
        .innerJoin(organizations, eq(organizations.id, entryOrganizations.organizationId))
        .where(and(eq(entryOrganizations.entryId, entryId), eq(entryOrganizations.role, 'studio'))),
      this.db
        .select({ slug: tags.slug, name: tags.name, namePolish: tags.namePolish, category: tags.category })
        .from(entryTags)
        .innerJoin(tags, eq(tags.id, entryTags.tagId))
        .where(eq(entryTags.entryId, entryId)),
    ]);

    return {
      ...row,
      bannerUrl: bannerAsset[0]?.url ?? null,
      bannerBlurhash: bannerAsset[0]?.blurhash ?? null,
      bannerWidth: bannerAsset[0]?.width ?? null,
      bannerHeight: bannerAsset[0]?.height ?? null,
      genres: entryGenreRows.map((g) => ({ slug: g.slug, name: g.namePolish ?? g.name })),
      studios: studioRows,
      tags: entryTagRows.map((tag) => ({ slug: tag.slug, name: tag.namePolish ?? tag.name, category: tag.category })),
    };
  }

  /**
   * Episodes for one specific entry under a series — verifies the entry
   * actually belongs to that series (via slug) before returning anything,
   * so an entry id from a different series can never leak episodes
   * through a mismatched slug in the URL.
   */
  async episodesForEntry(seriesSlug: string, entryId: string) {
    const rows = await this.db
      .select({
        id: episodes.id,
        entryId: episodes.entryId,
        number: episodes.number,
        absoluteNumber: episodes.absoluteNumber,
        title: episodes.title,
        synopsis: episodes.synopsis,
        airedAt: episodes.airedAt,
        durationSeconds: episodes.durationSeconds,
        isFiller: episodes.isFiller,
        isRecap: episodes.isRecap,
        introStartSeconds: episodes.introStartSeconds,
        introEndSeconds: episodes.introEndSeconds,
        outroStartSeconds: episodes.outroStartSeconds,
        earlyAccessUntil: episodes.earlyAccessUntil,
        entryVipOnly: entries.vipOnly,
      })
      .from(episodes)
      .innerJoin(entries, eq(entries.id, episodes.entryId))
      .innerJoin(series, eq(series.id, entries.seriesId))
      .where(
        and(
          eq(episodes.entryId, entryId),
          eq(series.slug, seriesSlug),
          isNull(episodes.deletedAt),
          isNull(entries.deletedAt),
          isNull(series.deletedAt),
        ),
      )
      .orderBy(asc(episodes.number));

    return rows;
  }

  async listGenres(includeMature: boolean): Promise<{ slug: string; name: string }[]> {
    const rows = await this.db
      .select({ slug: genres.slug, name: genres.name, namePolish: genres.namePolish })
      .from(genres)
      .where(includeMature ? undefined : eq(genres.isMature, false))
      .orderBy(asc(genres.name));
    return rows.map((row) => ({ slug: row.slug, name: row.namePolish ?? row.name }));
  }

  /** Mirrors listGenres — same Polish-if-available name resolution, for tags. */
  async listTags(includeAdult: boolean): Promise<{ slug: string; name: string; category: string | null }[]> {
    const rows = await this.db
      .select({
        slug: tags.slug,
        name: tags.name,
        namePolish: tags.namePolish,
        category: tags.category,
      })
      .from(tags)
      .where(includeAdult ? undefined : eq(tags.isAdult, false))
      .orderBy(asc(tags.name));
    return rows.map((row) => ({ slug: row.slug, name: row.namePolish ?? row.name, category: row.category }));
  }

  /** Artwork for a series' main entry (studios/genres/tags detail sections read the main entry, the same one card fields come from). */
  async assetsFor(seriesId: string) {
    return this.db
      .select({
        kind: mediaAssets.kind,
        url: mediaAssets.url,
        width: mediaAssets.width,
        height: mediaAssets.height,
        blurhash: mediaAssets.blurhash,
        locale: mediaAssets.locale,
        isPrimary: mediaAssets.isPrimary,
      })
      .from(mediaAssets)
      .where(eq(mediaAssets.seriesId, seriesId));
  }

  async studiosFor(seriesId: string) {
    return this.db
      .select({
        slug: organizations.slug,
        name: organizations.name,
        isPrimary: entryOrganizations.isPrimary,
      })
      .from(entries)
      .innerJoin(entryOrganizations, eq(entryOrganizations.entryId, entries.id))
      .innerJoin(organizations, eq(organizations.id, entryOrganizations.organizationId))
      .where(
        and(
          eq(entries.seriesId, seriesId),
          eq(entries.isMainEntry, true),
          eq(entryOrganizations.role, 'studio'),
          isNull(entries.deletedAt),
        ),
      )
      .orderBy(desc(entryOrganizations.isPrimary), asc(organizations.name));
  }

  async calendar(from: string, to: string, includeAdult: boolean) {
    return this.db
      .select({
        episodeId: episodes.id,
        seriesId: series.id,
        slug: series.slug,
        title: series.title,
        entryId: entries.id,
        entrySlug: entries.slug,
        entryTitle: entries.titleRomaji,
        format: entries.entryType,
        status: entries.status,
        posterUrl: mediaAssets.url,
        posterBlurhash: mediaAssets.blurhash,
        posterWidth: mediaAssets.width,
        posterHeight: mediaAssets.height,
        number: episodes.number,
        absoluteNumber: episodes.absoluteNumber,
        episodeTitle: episodes.title,
        synopsis: episodes.synopsis,
        airedAt: episodes.airedAt,
        durationSeconds: episodes.durationSeconds,
        isFiller: episodes.isFiller,
        isRecap: episodes.isRecap,
        introStartSeconds: episodes.introStartSeconds,
        introEndSeconds: episodes.introEndSeconds,
        outroStartSeconds: episodes.outroStartSeconds,
      })
      .from(episodes)
      .innerJoin(entries, eq(entries.id, episodes.entryId))
      .innerJoin(series, eq(series.id, entries.seriesId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.entryId, entries.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(
        and(
          sql`${episodes.airedAt} between ${from} and ${to}`,
          isNull(episodes.deletedAt),
          isNull(entries.deletedAt),
          includeAdult ? undefined : eq(entries.isAdult, false),
        ),
      )
      .orderBy(asc(episodes.airedAt), asc(series.title), asc(episodes.number));
  }

  /**
   * Time-windowed popularity ranking — distinct viewers (deduplicated per
   * user) with `episode_progress` activity for the series within the
   * window, `'all-time'` meaning no lower bound at all. See
   * `RankingPeriod`'s own doc comment in @playanime/contracts for why this
   * signal was chosen over the static `popularityScore` column or a
   * lifetime library-add count.
   *
   * Returns the same summary row shape `list()` does (so it hydrates
   * through the exact same `toAnimeSummary` mapper/`genresFor` call the
   * catalogue listing already uses) plus `viewerCount`.
   */
  async rankByViewers(period: RankingPeriod, limit: number, includeAdult: boolean) {
    const windowStart = periodStart(period);

    return this.db
      .select({
        id: series.id,
        slug: series.slug,
        title: series.title,
        format: entries.entryType,
        status: entries.status,
        season: entries.airingSeason,
        seasonYear: entries.airingYear,
        episodeCount: entries.episodeCount,
        averageRating: series.averageRating,
        anilistScore: series.anilistScore,
        popularityScore: series.popularityScore,
        posterUrl: sql<string | null>`coalesce(${series.posterUrl}, ${mediaAssets.url})`,
        posterBlurhash: sql<string | null>`case when ${series.posterUrl} is null then ${mediaAssets.blurhash} else null end`,
        posterWidth: sql<number | null>`case when ${series.posterUrl} is null then ${mediaAssets.width} else null end`,
        posterHeight: sql<number | null>`case when ${series.posterUrl} is null then ${mediaAssets.height} else null end`,
        // Cast to int: postgres.js deserializes a bare count(...) (int8/
        // bigint on the wire) as a STRING, not a number — confirmed live,
        // this silently produced `"1"` instead of `1` before the cast was
        // added, which would have violated RankingEntryDto's
        // Type.Integer() the moment a real request hit this endpoint. An
        // int4 (what ::int casts to) is what postgres.js actually
        // deserializes as a real JS number, matching the ::int pattern
        // admin.repository.ts's own count queries already use.
        viewerCount: sql<number>`count(distinct ${episodeProgress.userId})::int`,
      })
      .from(episodeProgress)
      .innerJoin(series, eq(series.id, episodeProgress.seriesId))
      .leftJoin(entries, and(eq(entries.seriesId, series.id), eq(entries.isMainEntry, true), isNull(entries.deletedAt)))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.entryId, entries.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(
        and(
          isNull(series.deletedAt),
          windowStart === null ? undefined : gte(episodeProgress.lastWatchedAt, windowStart),
          includeAdult ? undefined : sql`coalesce(${entries.isAdult}, false) = false`,
        ),
      )
      .groupBy(series.id, entries.id, mediaAssets.url, mediaAssets.blurhash, mediaAssets.width, mediaAssets.height)
      .orderBy(sql`count(distinct ${episodeProgress.userId}) desc`, desc(series.id))
      .limit(limit);
  }

  /** Genres attached to a set of series' main entries, for hydrating catalogue cards. */
  async genresFor(seriesIds: readonly string[]): Promise<Map<string, { slug: string; name: string }[]>> {
    if (seriesIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        seriesId: entries.seriesId,
        slug: genres.slug,
        name: genres.name,
        namePolish: genres.namePolish,
      })
      .from(entryGenres)
      .innerJoin(entries, eq(entries.id, entryGenres.entryId))
      .innerJoin(genres, eq(genres.id, entryGenres.genreId))
      .where(and(eq(entries.isMainEntry, true), sql`${entries.seriesId} = any(${sql.param(seriesIds)}::uuid[])`));

    const grouped = new Map<string, { slug: string; name: string }[]>();
    for (const row of rows) {
      const list = grouped.get(row.seriesId) ?? [];
      list.push({ slug: row.slug, name: row.namePolish ?? row.name });
      grouped.set(row.seriesId, list);
    }

    return grouped;
  }

  /** Tags attached to a set of series' main entries. Mirrors genresFor above. */
  async tagsFor(
    seriesIds: readonly string[],
  ): Promise<Map<string, { slug: string; name: string; category: string | null }[]>> {
    if (seriesIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        seriesId: entries.seriesId,
        slug: tags.slug,
        name: tags.name,
        namePolish: tags.namePolish,
        category: tags.category,
      })
      .from(entryTags)
      .innerJoin(entries, eq(entries.id, entryTags.entryId))
      .innerJoin(tags, eq(tags.id, entryTags.tagId))
      .where(and(eq(entries.isMainEntry, true), sql`${entries.seriesId} = any(${sql.param(seriesIds)}::uuid[])`));

    const grouped = new Map<string, { slug: string; name: string; category: string | null }[]>();
    for (const row of rows) {
      const list = grouped.get(row.seriesId) ?? [];
      list.push({ slug: row.slug, name: row.namePolish ?? row.name, category: row.category });
      grouped.set(row.seriesId, list);
    }

    return grouped;
  }

  /**
   * "When was this actually added or last got new episodes on PlayAnime" —
   * `GREATEST(series.createdAt, latest episodes.createdAt across the whole
   * series)`. Deliberately NOT `entries.startDate` (the anime's own
   * broadcast start date, wholly unrelated to catalogue activity — a real
   * bug this replaces: adding episodes to an already-catalogued, long-
   * finished-airing title like a years-old show never changed its
   * `startDate`, so it could never appear under "Recently Added" no matter
   * how recently its episodes were actually added). The MAX-episode-
   * createdAt subquery is what makes "just added new episodes to an
   * existing title" count as fresh, not only "a brand-new title was
   * created" — both are real catalogue activity a "recently added/
   * updated" rail should surface.
   */
  private readonly recentActivityAt = sql<string>`greatest(
    ${series.createdAt},
    coalesce(
      (
        select max(${episodes.createdAt})
        from ${episodes}
        inner join ${entries} as recent_entries on recent_entries.id = ${episodes.entryId}
        where recent_entries.series_id = ${series.id} and ${episodes.deletedAt} is null
      ),
      ${series.createdAt}
    )
  )`;

  /** Ordering clauses. The id tiebreaker keeps pagination deterministic. */
  private orderBy(sort: AnimeSort): SQL[] {
    switch (sort) {
      case 'rating':
        return [sql`${series.averageRating} desc nulls last`, desc(series.id)];
      case 'newest':
        return [sql`${this.recentActivityAt} desc`, desc(series.id)];
      case 'title':
        return [asc(series.title), asc(series.id)];
      case 'popularity':
      default:
        return [desc(series.popularityScore), desc(series.id)];
    }
  }

  /**
   * Keyset predicate.
   *
   * Compares the tuple (sort value, id) rather than an offset, so a page never
   * skips or repeats a row when the underlying data changes between requests.
   */
  private keysetCondition(sort: AnimeSort, cursor: AnimeCursor): SQL | undefined {
    switch (sort) {
      case 'title':
        return or(
          gt(series.title, String(cursor.v)),
          and(eq(series.title, String(cursor.v)), gt(series.id, cursor.id)),
        );
      case 'rating':
        return sql`(${series.averageRating}, ${series.id}) < (${cursor.v}, ${cursor.id})`;
      case 'newest':
        return sql`(${this.recentActivityAt}, ${series.id}) < (${cursor.v}, ${cursor.id})`;
      case 'popularity':
      default:
        return or(
          lt(series.popularityScore, Number(cursor.v)),
          and(eq(series.popularityScore, Number(cursor.v)), lt(series.id, cursor.id)),
        );
    }
  }

  private cursorValue(sort: AnimeSort, row: AnimeListRow): string | number {
    switch (sort) {
      case 'rating':
        return row.averageRating ?? '0';
      case 'newest': {
        // A real, separate pre-existing bug fixed alongside the ORDER BY
        // itself: this used to return `row.seasonYear` — a field the sort
        // never actually ordered by even before this fix (it ordered by
        // `entries.startDate`) — so keyset pagination past page 1 on this
        // sort was already comparing the wrong column against the cursor.
        // Now consistent with `orderBy`/`keysetCondition`'s own value.
        //
        // `recentActivityAt` arrives as a STRING (postgres.js's own
        // deserialization of this timestamptz expression), confirmed live
        // — an earlier version of this code assumed `Date` and called
        // `.toISOString()` on it, which crashed instantly the first time
        // this ran against real data.
        return row.recentActivityAt ?? new Date(0).toISOString();
      }
      case 'title':
        return row.title;
      case 'popularity':
      default:
        return row.popularityScore;
    }
  }
}
