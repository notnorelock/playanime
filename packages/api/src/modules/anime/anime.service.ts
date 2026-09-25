import { NotFoundError, clampPageSize, ErrorCode } from '@playanime/shared';
import type { AnimeListQuery, AnimePage, EntryDetailDto, EntrySummaryDto, SeriesDetailDto } from '@playanime/contracts';
import { AnimeRepository, CatalogueRepository, db, type SeriesEntryRow } from '@playanime/database';
import { cacheGetOrSet, redisKeys, redisTtl } from '@playanime/redis';
import { toAnimeDetail, toAnimeSummary, toEntryDetail } from './anime.mapper.js';

/**
 * Catalogue reads.
 *
 * A service layer is warranted here because listing composes three concerns —
 * filtering, cursor pagination, and cache keying — that the controller should
 * not know about. Simpler modules in this API skip the layer and query directly
 * rather than adding indirection that only forwards calls.
 */

const repository = new AnimeRepository(db());
const catalogueRepository = new CatalogueRepository(db());

/** `AnimeListQuery.seasonYear` accepts a numeric string too (query params are always strings on the wire) — parsed back to a real number here, once, before it reaches anywhere that compares it numerically. An unparseable value is treated as no filter, not clamped to a default the way `clampPageSize` clamps a bad limit — there is no sensible "default year" to fall back to. */
function parseSeasonYear(value: AnimeListQuery['seasonYear']): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Builds a stable cache key from the filters.
 *
 * Sorted so `?genre=akcja&sort=rating` and `?sort=rating&genre=akcja` share one
 * entry, and hashed so a long filter set cannot produce an unbounded key.
 */
function filterHash(query: AnimeListQuery, includeAdult: boolean): string {
  const normalized = Object.entries({
    search: query.search ?? '',
    genre: query.genre ?? '',
    tag: query.tag ?? '',
    entryType: query.entryType ?? '',
    status: query.status ?? '',
    season: query.season ?? '',
    seasonYear: parseSeasonYear(query.seasonYear) ?? '',
    sort: query.sort ?? 'popularity',
    limit: clampPageSize(query.limit),
    cursor: query.cursor ?? '',
    adult: includeAdult,
  })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');

  return new Bun.CryptoHasher('sha256').update(normalized).digest('hex').slice(0, 32);
}

/** Attaches genres to a page of summaries in one query rather than N. */
async function hydrate(rows: readonly Awaited<ReturnType<AnimeRepository['list']>>['items'][number][]) {
  const genreMap = await repository.genresFor(rows.map((row) => row.id));
  return rows.map((row) => toAnimeSummary(row, genreMap.get(row.id) ?? []));
}

export async function listAnime(query: AnimeListQuery, includeAdult: boolean): Promise<AnimePage> {
  const limit = clampPageSize(query.limit);

  // Search results are not cached: they are long-tail, so the hit rate is poor
  // and the keyspace grows without bound.
  const cacheable = query.search === undefined || query.search.length === 0;

  const compute = async (): Promise<AnimePage> => {
    const page = await repository.list(
      {
        search: query.search,
        genre: query.genre,
        tag: query.tag,
        entryType: query.entryType,
        status: query.status,
        season: query.season,
        seasonYear: parseSeasonYear(query.seasonYear),
        sort: query.sort,
        includeAdult,
      },
      limit,
      query.cursor ?? null,
    );

    return {
      items: await hydrate(page.items),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  };

  if (!cacheable) return compute();

  return cacheGetOrSet(
    redisKeys.animeList(filterHash(query, includeAdult)),
    { ttlSeconds: redisTtl.animeList },
    compute,
  );
}

function toEntrySummary(row: SeriesEntryRow): EntrySummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    entryType: row.entryType,
    titles: {
      romaji: row.titleRomaji,
      english: row.titleEnglish,
      native: row.titleNative,
    },
    seasonNumber: row.seasonNumber,
    courNumber: row.courNumber,
    airingSeason: row.airingSeason,
    airingYear: row.airingYear,
    status: row.status,
    episodeCount: row.episodeCount,
    poster:
      row.posterUrl === null
        ? null
        : { url: row.posterUrl, blurhash: row.posterBlurhash, width: row.posterWidth, height: row.posterHeight },
    releaseOrder: row.releaseOrder,
    chronologicalOrder: row.chronologicalOrder,
    isMainEntry: row.isMainEntry,
  };
}

/**
 * Series detail, with every entry (season/extras breakdown) embedded in the
 * same response — returning it separately would be exactly the N+1 the
 * catalogue read path avoids elsewhere (one request per season/OVA/movie).
 */
export async function getAnimeBySlug(slug: string, includeAdult: boolean): Promise<SeriesDetailDto> {
  const row = await repository.findBySlug(slug);

  if (row === null || (!includeAdult && row.isAdult)) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  const [genreMap, entryRows] = await Promise.all([
    repository.genresFor([row.id]),
    catalogueRepository.listEntriesForSeries(row.id),
  ]);

  return toAnimeDetail(row, genreMap.get(row.id) ?? [], entryRows.map(toEntrySummary));
}

/** Full detail for one entry (a season/movie/OVA) — fetched once the viewer picks a non-default entry in the season selector. */
export async function getEntryDetail(slug: string, entryId: string): Promise<EntryDetailDto> {
  const row = await repository.findEntryDetail(slug, entryId);
  if (row === null) {
    throw new NotFoundError('Nie znaleziono tego wydania.', { code: ErrorCode.ANIME_NOT_FOUND });
  }
  return toEntryDetail(row);
}
