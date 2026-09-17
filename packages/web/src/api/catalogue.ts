import type {
  AnimeAutofillResponse,
  AnimeCreateBody,
  AnimeCreateResponse,
  AnimeEditBody,
  AnimeSearchResponse,
  CataloguePermissions,
  DuplicateCheckResponse,
  EpisodeBulkCreateBody,
  EpisodeBulkCreateResponse,
  EpisodeCreateBody,
  EpisodeCreateResponse,
  EpisodeEditBody,
  MediaAssetUpsertBody,
  OwnedSourceListResponse,
  SourceBatchSubmissionRequest,
  SourceBatchSubmissionResponse,
  SourceUpdateBody,
} from '@playanime/contracts';
import { http } from './client';

/** An episode as the authoring view shows it, with its source counts. */
export interface EditableEpisode {
  readonly id: string;
  readonly number: number;
  readonly title: string | null;
  readonly airedAt: string | null;
  readonly durationSeconds: number | null;
  readonly isFiller: boolean;
  readonly isRecap: boolean;
  readonly introStartSeconds: number | null;
  readonly introEndSeconds: number | null;
  readonly outroStartSeconds: number | null;
  readonly sourceCount: number;
  readonly pendingSourceCount: number;
}

/**
 * Catalogue authoring.
 *
 * Every call here writes, and every one is authorized server-side against the
 * platform role combined with translator-group membership. `permissions()`
 * exists so the UI can render the right controls — it is not the access check,
 * and a client that ignores it gets a 403.
 */
export const catalogueApi = {
  permissions: (signal?: AbortSignal): Promise<CataloguePermissions> =>
    http.get<CataloguePermissions>('/catalogue/permissions', signal === undefined ? {} : { signal }),

  /** Titles resembling a proposed one. Advisory; creation is never refused. */
  duplicates: (title: string, signal?: AbortSignal): Promise<DuplicateCheckResponse> =>
    http.get<DuplicateCheckResponse>('/catalogue/duplicates', {
      query: { title },
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Live AniList title search, for the "add anime" form's autocomplete. */
  searchAniList: (title: string, signal?: AbortSignal): Promise<AnimeSearchResponse> =>
    http.get<AnimeSearchResponse>('/catalogue/anilist-search', {
      query: { title },
      ...(signal === undefined ? {} : { signal }),
    }),

  /** Fetches the full autofill payload for one picked AniList search result. */
  autofillFromAniList: (anilistId: number): Promise<AnimeAutofillResponse> =>
    http.get<AnimeAutofillResponse>(`/catalogue/anilist-import/${String(anilistId)}`),

  /* ------------------------------------------------------------------ */
  /* Titles                                                              */
  /* ------------------------------------------------------------------ */

  createAnime: (body: AnimeCreateBody): Promise<AnimeCreateResponse> =>
    http.post<AnimeCreateResponse>('/catalogue/anime', { body }),

  updateAnime: (slug: string, body: AnimeEditBody): Promise<AnimeCreateResponse> =>
    http.patch<AnimeCreateResponse>(`/catalogue/anime/${encodeURIComponent(slug)}`, { body }),

  addAsset: (slug: string, body: MediaAssetUpsertBody): Promise<{ id: string }> =>
    http.post<{ id: string }>(`/catalogue/anime/${encodeURIComponent(slug)}/assets`, { body }),

  /* ------------------------------------------------------------------ */
  /* Episodes                                                            */
  /* ------------------------------------------------------------------ */

  episodes: (slug: string, signal?: AbortSignal): Promise<EditableEpisode[]> =>
    http.get<EditableEpisode[]>(
      `/catalogue/anime/${encodeURIComponent(slug)}/episodes`,
      signal === undefined ? {} : { signal },
    ),

  createEpisode: (slug: string, body: EpisodeCreateBody): Promise<EpisodeCreateResponse> =>
    http.post<EpisodeCreateResponse>(`/catalogue/anime/${encodeURIComponent(slug)}/episodes`, {
      body,
    }),

  /** Adds a contiguous range. Existing numbers are skipped and reported. */
  createEpisodeRange: (
    slug: string,
    body: EpisodeBulkCreateBody,
  ): Promise<EpisodeBulkCreateResponse> =>
    http.post<EpisodeBulkCreateResponse>(
      `/catalogue/anime/${encodeURIComponent(slug)}/episodes/bulk`,
      { body },
    ),

  updateEpisode: (episodeId: string, body: EpisodeEditBody): Promise<{ id: string }> =>
    http.patch<{ id: string }>(`/catalogue/episodes/${encodeURIComponent(episodeId)}`, { body }),

  /** Soft delete: watch progress and comments keep their referent. */
  deleteEpisode: (episodeId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/catalogue/episodes/${encodeURIComponent(episodeId)}`),

  /* ------------------------------------------------------------------ */
  /* Sources                                                             */
  /* ------------------------------------------------------------------ */

  /** Every source on an episode, including rows awaiting moderation. */
  sources: (episodeId: string, signal?: AbortSignal): Promise<OwnedSourceListResponse> =>
    http.get<OwnedSourceListResponse>(
      `/catalogue/episodes/${encodeURIComponent(episodeId)}/sources`,
      signal === undefined ? {} : { signal },
    ),

  /**
   * Submits one or more sources at once.
   *
   * Partial success is normal: the response reports each URL separately, so a
   * dead mirror among several does not discard the ones that worked.
   */
  submitSources: (
    episodeId: string,
    body: SourceBatchSubmissionRequest,
  ): Promise<SourceBatchSubmissionResponse> =>
    http.post<SourceBatchSubmissionResponse>(
      `/catalogue/episodes/${encodeURIComponent(episodeId)}/sources`,
      { body },
    ),

  updateSource: (sourceId: string, body: SourceUpdateBody): Promise<{ id: string }> =>
    http.patch<{ id: string }>(`/catalogue/sources/${encodeURIComponent(sourceId)}`, { body }),

  withdrawSource: (sourceId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/catalogue/sources/${encodeURIComponent(sourceId)}`),
};
