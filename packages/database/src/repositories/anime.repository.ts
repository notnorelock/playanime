import { and, asc, desc, eq, gt, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { buildCursorPage, decodeCursor, encodeCursor, type CursorPage } from '@playanime/shared';
import type { AnimeSort, ReleaseStatus, SeasonOfYear, TitleFormat } from '@playanime/contracts';
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
  tags,
} from '../schema/anime.js';

/**
 * Anime catalogue queries.
 *
 * Repositories exist here for the catalogue because its queries are genuinely
 * involved — keyset pagination over several sort orders, artwork joins, genre
 * filtering. Simpler domains do not get a repository; the API module queries
 * Drizzle directly rather than adding a layer that only forwards calls.
 */

export interface AnimeListFilters {
  readonly search?: string | undefined;
  readonly genre?: string | undefined;
  readonly tag?: string | undefined;
  readonly format?: TitleFormat | undefined;
  readonly status?: ReleaseStatus | undefined;
  readonly season?: SeasonOfYear | undefined;
  readonly seasonYear?: number | undefined;
  readonly sort?: AnimeSort | undefined;
  readonly includeAdult?: boolean | undefined;
}

/** Row shape returned by catalogue queries, before mapping to a DTO. */
export interface AnimeListRow {
  id: string;
  slug: string;
  titleRomaji: string;
  titleEnglish: string | null;
  titleNative: string | null;
  format: TitleFormat;
  status: ReleaseStatus;
  season: SeasonOfYear | null;
  seasonYear: number | null;
  episodeCount: number | null;
  averageRating: string | null;
  popularityScore: number;
  posterUrl: string | null;
  posterBlurhash: string | null;
  posterWidth: number | null;
  posterHeight: number | null;
}

export interface AnimeDetailRow extends AnimeListRow {
  synopsis: string | null;
  ageRating: typeof anime.$inferSelect.ageRating;
  durationMinutes: number | null;
  startDate: string | null;
  endDate: string | null;
  ratingCount: number;
  isAdult: boolean;
  updatedAt: Date;
  createdByGroupId: string | null;
  anilistId: number | null;
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
    const conditions: SQL[] = [isNull(anime.deletedAt)];

    if (filters.includeAdult !== true) {
      conditions.push(eq(anime.isAdult, false));
    }

    if (filters.search !== undefined && filters.search.length > 0) {
      const pattern = `%${filters.search}%`;
      const match = or(
        ilike(anime.titleRomaji, pattern),
        ilike(anime.titleEnglish, pattern),
      );
      if (match !== undefined) conditions.push(match);
    }

    if (filters.format !== undefined) conditions.push(eq(anime.format, filters.format));
    if (filters.status !== undefined) conditions.push(eq(anime.status, filters.status));
    if (filters.season !== undefined) conditions.push(eq(anime.season, filters.season));
    if (filters.seasonYear !== undefined) conditions.push(eq(anime.seasonYear, filters.seasonYear));

    if (filters.genre !== undefined) {
      // EXISTS rather than a join: a join would duplicate rows for titles
      // matching several genres and break the page size.
      conditions.push(
        sql`exists (
          select 1 from ${animeGenres}
          inner join ${genres} on ${genres.id} = ${animeGenres.genreId}
          where ${animeGenres.animeId} = ${anime.id} and ${genres.slug} = ${filters.genre}
        )`,
      );
    }

    if (filters.tag !== undefined) {
      // Mirrors the genre filter above, same EXISTS reasoning.
      conditions.push(
        sql`exists (
          select 1 from ${animeTags}
          inner join ${tags} on ${tags.id} = ${animeTags.tagId}
          where ${animeTags.animeId} = ${anime.id} and ${tags.slug} = ${filters.tag}
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
        id: anime.id,
        slug: anime.slug,
        titleRomaji: anime.titleRomaji,
        titleEnglish: anime.titleEnglish,
        titleNative: anime.titleNative,
        format: anime.format,
        status: anime.status,
        season: anime.season,
        seasonYear: anime.seasonYear,
        episodeCount: anime.episodeCount,
        averageRating: anime.averageRating,
        popularityScore: anime.popularityScore,
        posterUrl: mediaAssets.url,
        posterBlurhash: mediaAssets.blurhash,
        posterWidth: mediaAssets.width,
        posterHeight: mediaAssets.height,
      })
      .from(anime)
      // Left join so a title without artwork still appears in the catalogue.
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.animeId, anime.id),
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

  /** Full detail for a title page, by slug. */
  /**
   * Existence check by id.
   *
   * Returns the identifying columns only: callers that need one field to
   * validate a foreign key should not pull a full detail row to get it.
   */
  async findById(animeId: string) {
    const [row] = await this.db
      .select({ id: anime.id, slug: anime.slug, title: anime.titleRomaji })
      .from(anime)
      .where(and(eq(anime.id, animeId), isNull(anime.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async findBySlug(slug: string): Promise<AnimeDetailRow | null> {
    const [row] = await this.db
      .select({
        id: anime.id,
        slug: anime.slug,
        titleRomaji: anime.titleRomaji,
        titleEnglish: anime.titleEnglish,
        titleNative: anime.titleNative,
        format: anime.format,
        status: anime.status,
        season: anime.season,
        seasonYear: anime.seasonYear,
        episodeCount: anime.episodeCount,
        averageRating: anime.averageRating,
        popularityScore: anime.popularityScore,
        synopsis: anime.synopsis,
        ageRating: anime.ageRating,
        durationMinutes: anime.durationMinutes,
        startDate: anime.startDate,
        endDate: anime.endDate,
        ratingCount: anime.ratingCount,
        isAdult: anime.isAdult,
        updatedAt: anime.updatedAt,
        createdByGroupId: anime.createdByGroupId,
        anilistId: anime.anilistId,
        posterUrl: mediaAssets.url,
        posterBlurhash: mediaAssets.blurhash,
        posterWidth: mediaAssets.width,
        posterHeight: mediaAssets.height,
      })
      .from(anime)
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.animeId, anime.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(and(eq(anime.slug, slug), isNull(anime.deletedAt)))
      .limit(1);

    return row ?? null;
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

  async assetsFor(animeId: string) {
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
      .where(eq(mediaAssets.animeId, animeId));
  }

  async studiosFor(animeId: string) {
    return this.db
      .select({
        slug: organizations.slug,
        name: organizations.name,
        isPrimary: animeOrganizations.isPrimary,
      })
      .from(animeOrganizations)
      .innerJoin(organizations, eq(organizations.id, animeOrganizations.organizationId))
      .where(and(eq(animeOrganizations.animeId, animeId), eq(animeOrganizations.role, 'studio')))
      .orderBy(desc(animeOrganizations.isPrimary), asc(organizations.name));
  }

  async calendar(from: string, to: string, includeAdult: boolean) {
    return this.db
      .select({
        episodeId: episodes.id,
        animeId: anime.id,
        slug: anime.slug,
        titleRomaji: anime.titleRomaji,
        format: anime.format,
        status: anime.status,
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
      .innerJoin(anime, eq(anime.id, episodes.animeId))
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.animeId, anime.id),
          eq(mediaAssets.kind, 'poster'),
          eq(mediaAssets.isPrimary, true),
        ),
      )
      .where(
        and(
          sql`${episodes.airedAt} between ${from} and ${to}`,
          isNull(episodes.deletedAt),
          isNull(anime.deletedAt),
          includeAdult ? undefined : eq(anime.isAdult, false),
        ),
      )
      .orderBy(asc(episodes.airedAt), asc(anime.titleRomaji), asc(episodes.number));
  }

  /** Genres attached to a set of titles, for hydrating catalogue cards. */
  async genresFor(animeIds: readonly string[]): Promise<Map<string, { slug: string; name: string }[]>> {
    if (animeIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        animeId: animeGenres.animeId,
        slug: genres.slug,
        name: genres.name,
        namePolish: genres.namePolish,
      })
      .from(animeGenres)
      .innerJoin(genres, eq(genres.id, animeGenres.genreId))
      .where(sql`${animeGenres.animeId} = any(${sql.param(animeIds)}::uuid[])`);

    const grouped = new Map<string, { slug: string; name: string }[]>();
    for (const row of rows) {
      const list = grouped.get(row.animeId) ?? [];
      list.push({ slug: row.slug, name: row.namePolish ?? row.name });
      grouped.set(row.animeId, list);
    }

    return grouped;
  }

  /** Tags attached to a set of titles. Mirrors genresFor above. */
  async tagsFor(
    animeIds: readonly string[],
  ): Promise<Map<string, { slug: string; name: string; category: string | null }[]>> {
    if (animeIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        animeId: animeTags.animeId,
        slug: tags.slug,
        name: tags.name,
        namePolish: tags.namePolish,
        category: tags.category,
      })
      .from(animeTags)
      .innerJoin(tags, eq(tags.id, animeTags.tagId))
      .where(sql`${animeTags.animeId} = any(${sql.param(animeIds)}::uuid[])`);

    const grouped = new Map<string, { slug: string; name: string; category: string | null }[]>();
    for (const row of rows) {
      const list = grouped.get(row.animeId) ?? [];
      list.push({ slug: row.slug, name: row.namePolish ?? row.name, category: row.category });
      grouped.set(row.animeId, list);
    }

    return grouped;
  }

  /** Ordering clauses. The id tiebreaker keeps pagination deterministic. */
  private orderBy(sort: AnimeSort): SQL[] {
    switch (sort) {
      case 'rating':
        return [sql`${anime.averageRating} desc nulls last`, desc(anime.id)];
      case 'newest':
        return [sql`${anime.startDate} desc nulls last`, desc(anime.id)];
      case 'title':
        return [asc(anime.titleRomaji), asc(anime.id)];
      case 'popularity':
      default:
        return [desc(anime.popularityScore), desc(anime.id)];
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
          gt(anime.titleRomaji, String(cursor.v)),
          and(eq(anime.titleRomaji, String(cursor.v)), gt(anime.id, cursor.id)),
        );
      case 'rating':
        return sql`(${anime.averageRating}, ${anime.id}) < (${cursor.v}, ${cursor.id})`;
      case 'newest':
        return sql`(${anime.startDate}, ${anime.id}) < (${cursor.v}, ${cursor.id})`;
      case 'popularity':
      default:
        return or(
          lt(anime.popularityScore, Number(cursor.v)),
          and(eq(anime.popularityScore, Number(cursor.v)), lt(anime.id, cursor.id)),
        );
    }
  }

  private cursorValue(sort: AnimeSort, row: AnimeListRow): string | number {
    switch (sort) {
      case 'rating':
        return row.averageRating ?? '0';
      case 'newest':
        return row.seasonYear ?? 0;
      case 'title':
        return row.titleRomaji;
      case 'popularity':
      default:
        return row.popularityScore;
    }
  }
}
