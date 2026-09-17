import { NotFoundError, clampPageSize, ErrorCode } from '@playanime/shared';
import type { AnimeDetail, AnimeListQuery, AnimePage } from '@playanime/contracts';
import { AnimeRepository, db } from '@playanime/database';
import { cacheGetOrSet, redisKeys, redisTtl } from '@playanime/redis';
import { toAnimeDetail, toAnimeSummary } from './anime.mapper.js';

/**
 * Catalogue reads.
 *
 * A service layer is warranted here because listing composes three concerns —
 * filtering, cursor pagination, and cache keying — that the controller should
 * not know about. Simpler modules in this API skip the layer and query directly
 * rather than adding indirection that only forwards calls.
 */

const repository = new AnimeRepository(db());

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
    format: query.format ?? '',
    status: query.status ?? '',
    season: query.season ?? '',
    seasonYear: query.seasonYear ?? '',
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
        format: query.format,
        status: query.status,
        season: query.season,
        seasonYear: query.seasonYear,
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

export async function getAnimeBySlug(slug: string, includeAdult: boolean): Promise<AnimeDetail> {
  const row = await repository.findBySlug(slug);

  if (row === null || (!includeAdult && row.isAdult)) {
    throw new NotFoundError('Nie znaleziono tego anime.', { code: ErrorCode.ANIME_NOT_FOUND });
  }

  const [genreMap, assets, studios, tagMap] = await Promise.all([
    repository.genresFor([row.id]),
    repository.assetsFor(row.id),
    repository.studiosFor(row.id),
    repository.tagsFor([row.id]),
  ]);
  return toAnimeDetail(row, genreMap.get(row.id) ?? [], assets, studios, tagMap.get(row.id) ?? []);
}
