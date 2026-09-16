import type {
  AnimeDetail,
  AnimeListQuery,
  AnimePage,
  EpisodeSummary,
  GenreListResponse,
} from '@playanime/contracts';
import { http, type QueryParams } from './client';

/**
 * Catalogue reads.
 *
 * Filtering, sorting and pagination are all server-side: the API is indexed for
 * them, and the browser must never receive a whole catalogue in order to sort
 * twelve cards out of it.
 */
export const animeApi = {
  list: (query: AnimeListQuery = {}, signal?: AbortSignal): Promise<AnimePage> =>
    http.get<AnimePage>('/anime', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Titles are addressed by slug. Numeric ids belonged to the old backend. */
  bySlug: (slug: string, signal?: AbortSignal): Promise<AnimeDetail> =>
    http.get<AnimeDetail>(`/anime/${encodeURIComponent(slug)}`, signal === undefined ? {} : { signal }),

  episodes: (slug: string, signal?: AbortSignal): Promise<EpisodeSummary[]> =>
    http.get<EpisodeSummary[]>(
      `/anime/${encodeURIComponent(slug)}/episodes`,
      signal === undefined ? {} : { signal },
    ),

  genres: (signal?: AbortSignal): Promise<GenreListResponse> =>
    http.get<GenreListResponse>('/genres', signal === undefined ? {} : { signal }),
};
