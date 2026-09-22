import type { RankingPeriod, RankingResponse } from '@playanime/contracts';
import { AnimeRepository, db, type AnimeListRow } from '@playanime/database';
import { cacheGetOrSet, redisKeys, redisTtl } from '@playanime/redis';
import { toAnimeSummary } from '../anime/anime.mapper.js';

/**
 * Time-windowed popularity ranking for the home page — "most watched this
 * week/month/year/all-time." See `RankingPeriod`'s doc comment in
 * @playanime/contracts for the ranking basis (distinct viewers, not the
 * static popularityScore column or a lifetime library-add count).
 */

const repository = new AnimeRepository(db());

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** `RankingQuery.limit`'s own bounds are wire-level (1-50); this is where "no limit sent" becomes DEFAULT_LIMIT rather than clampPageSize's unrelated catalogue-listing default. */
function resolveLimit(requested: number | string | undefined): number {
  if (requested === undefined) return DEFAULT_LIMIT;
  const parsed = typeof requested === 'string' ? Number.parseInt(requested, 10) : requested;
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

export async function getRanking(
  period: RankingPeriod,
  limitInput: number | string | undefined,
  includeAdult: boolean,
): Promise<RankingResponse> {
  const limit = resolveLimit(limitInput);

  // Cached at MAX_LIMIT and sliced afterward, not cached per-requested-limit
  // — the cache key only varies by period + adult-filter (a small, known
  // keyspace), so a 10-row request and a 30-row request for the same
  // period/filter combination share one cache entry instead of two
  // independently-TTL'd, mostly-overlapping ones. Caching per-limit would
  // also risk a real bug: a 10-row result cached first and then served to
  // a 30-row request would silently under-return.
  const full = await cacheGetOrSet(
    redisKeys.animeRanking(period, includeAdult),
    { ttlSeconds: redisTtl.animeRanking },
    async (): Promise<RankingResponse> => {
      const rows = (await repository.rankByViewers(period, MAX_LIMIT, includeAdult)) as readonly (AnimeListRow & {
        viewerCount: number;
      })[];

      const genreMap = await repository.genresFor(rows.map((row) => row.id));

      return {
        period,
        entries: rows.map((row, index) => ({
          rank: index + 1,
          series: toAnimeSummary(row, genreMap.get(row.id) ?? []),
          viewerCount: row.viewerCount,
        })),
      };
    },
  );

  return { period, entries: full.entries.slice(0, limit) };
}
