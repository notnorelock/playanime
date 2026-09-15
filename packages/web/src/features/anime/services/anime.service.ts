import type { AnimePage, AnimeSummary, AnimeListQuery } from '@playanime/contracts';
import { api } from '~/services/api-client.js';

/**
 * Catalogue API calls.
 *
 * Feature-scoped: the anime feature owns the shape of its own requests, so
 * adding a filter does not touch a shared client that every other feature also
 * imports.
 */

export function listAnime(
  query: AnimeListQuery = {},
  signal?: AbortSignal,
): Promise<AnimePage> {
  return api.get<AnimePage>('/anime', {
    query: {
      search: query.search,
      genre: query.genre,
      format: query.format,
      status: query.status,
      season: query.season,
      seasonYear: query.seasonYear,
      sort: query.sort,
      limit: query.limit,
      cursor: query.cursor,
    },
    signal,
  });
}

export function getAnime(slug: string, signal?: AbortSignal): Promise<AnimeSummary> {
  return api.get<AnimeSummary>(`/anime/${encodeURIComponent(slug)}`, { signal });
}

export interface EpisodeSummary {
  id: string;
  number: number;
  absoluteNumber: number | null;
  title: string | null;
  titlePolish: string | null;
  synopsis: string | null;
  airedAt: string | null;
  durationSeconds: number | null;
  isFiller: boolean;
  isRecap: boolean;
  introStartSeconds: number | null;
  introEndSeconds: number | null;
  outroStartSeconds: number | null;
}

export function listEpisodes(slug: string, signal?: AbortSignal): Promise<EpisodeSummary[]> {
  return api.get<EpisodeSummary[]>(`/anime/${encodeURIComponent(slug)}/episodes`, { signal });
}
