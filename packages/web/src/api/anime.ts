import type {
  AnimeListQuery,
  AnimePage,
  EntryDetailDto,
  EpisodeSummary,
  GenreListResponse,
  SeriesDetailDto,
  TagListResponse,
} from '@playanime/contracts';
import { http, type QueryParams } from './client';

/**
 * Catalogue reads.
 *
 * Filtering, sorting and pagination are all server-side: the API is indexed for
 * them, and the browser must never receive a whole catalogue in order to sort
 * twelve cards out of it.
 *
 * A "title" is a Series; `bySlug` returns the full season/extras breakdown
 * (`entries[]`) in the same response, so the detail page never needs a
 * separate round trip per season/OVA/movie.
 */
export const animeApi = {
  list: (query: AnimeListQuery = {}, signal?: AbortSignal): Promise<AnimePage> =>
    http.get<AnimePage>('/anime', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Titles are addressed by slug. Numeric ids belonged to the old backend. */
  bySlug: (slug: string, signal?: AbortSignal): Promise<SeriesDetailDto> =>
    http.get<SeriesDetailDto>(`/anime/${encodeURIComponent(slug)}`, signal === undefined ? {} : { signal }),

  /** Episodes of the series' main entry — the common single-release case. */
  episodes: (slug: string, signal?: AbortSignal): Promise<EpisodeSummary[]> =>
    http.get<EpisodeSummary[]>(
      `/anime/${encodeURIComponent(slug)}/episodes`,
      signal === undefined ? {} : { signal },
    ),

  /** Episodes of one specific entry (a season, OVA, movie...) under the series. */
  entryEpisodes: (slug: string, entryId: string, signal?: AbortSignal): Promise<EpisodeSummary[]> =>
    http.get<EpisodeSummary[]>(
      `/anime/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}/episodes`,
      signal === undefined ? {} : { signal },
    ),

  /** Full detail for one entry — synopsis, dates, studios/genres/tags — fetched once the season selector picks a non-default entry. */
  entryDetail: (slug: string, entryId: string, signal?: AbortSignal): Promise<EntryDetailDto> =>
    http.get<EntryDetailDto>(
      `/anime/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entryId)}`,
      signal === undefined ? {} : { signal },
    ),

  genres: (signal?: AbortSignal): Promise<GenreListResponse> =>
    http.get<GenreListResponse>('/genres', signal === undefined ? {} : { signal }),

  tags: (signal?: AbortSignal): Promise<TagListResponse> =>
    http.get<TagListResponse>('/tags', signal === undefined ? {} : { signal }),
};
