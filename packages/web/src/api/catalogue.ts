import type {
  AnimeAutofillResponse,
  AnimeSearchResponse,
  AnimeSyncResponse,
  CatalogueAuditTrail,
  CataloguePermissions,
  CatalogueProposalDecisionBody,
  CatalogueProposalQueue,
  DuplicateCheckResponse,
  EntryByAnilistResponse,
  EntryCreateBody,
  EntryCreateResponse,
  EntryEditBody,
  EpisodeBulkCreateBody,
  EpisodeBulkCreateResponse,
  EpisodeCreateBody,
  EpisodeCreateResponse,
  EpisodeEditBody,
  MediaAssetUpsertBody,
  OwnedSourceListResponse,
  ProposeAnimeEditResponse,
  SeriesCreateBody,
  SeriesCreateResponse,
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
  /** VIP early-access window — null means never gated this way. Settable by the uploading group or staff, unlike the entry-level `vipOnly` toggle, which is admin-only. */
  readonly earlyAccessUntil: string | null;
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

  /** Finds the catalogue entry already linked to an AniList id, if any — a pure local lookup, no AniList request. */
  findAnimeByAnilistId: (anilistId: number): Promise<EntryByAnilistResponse> =>
    http.get<EntryByAnilistResponse>(`/catalogue/anime/by-anilist/${String(anilistId)}`),

  /**
   * Links an EXISTING title to an AniList entry and syncs it — overwrites
   * the poster/banner, adds any matched genres and AniList tags. Never
   * removes anything already attached.
   */
  syncAnimeFromAniList: (slug: string, anilistId: number): Promise<AnimeSyncResponse> =>
    http.post<AnimeSyncResponse>(`/catalogue/anime/${encodeURIComponent(slug)}/sync-anilist`, {
      body: { anilistId },
    }),

  /* ------------------------------------------------------------------ */
  /* Titles                                                              */
  /* ------------------------------------------------------------------ */

  /** Creates a series, optionally with its first entry (`body.firstEntry`) in the same call — the common "add anime" case. */
  createAnime: (body: SeriesCreateBody): Promise<SeriesCreateResponse> =>
    http.post<SeriesCreateResponse>('/catalogue/anime', { body }),

  /**
   * Edits a title's main entry. Staff or the owning group write instantly
   * (`{ id, slug }`); anyone else with editor-or-above rank in some OTHER
   * group gets `ProposeAnimeEditResponse` instead — the edit was queued
   * for the owning group or staff to approve, not applied.
   */
  updateAnime: (
    slug: string,
    body: EntryEditBody,
  ): Promise<{ id: string; slug: string } | ProposeAnimeEditResponse> =>
    http.patch<{ id: string; slug: string } | ProposeAnimeEditResponse>(
      `/catalogue/anime/${encodeURIComponent(slug)}`,
      { body },
    ),

  /** Adds a new entry (a season, cour, movie, OVA...) to an EXISTING series — the "add Season 2" action. Additive, so any authorized group may call it, not only the series' own creator. */
  addEntry: (slug: string, body: EntryCreateBody): Promise<EntryCreateResponse> =>
    http.post<EntryCreateResponse>(`/catalogue/anime/${encodeURIComponent(slug)}/entries`, { body }),

  addAsset: (slug: string, body: MediaAssetUpsertBody): Promise<{ id: string }> =>
    http.post<{ id: string }>(`/catalogue/anime/${encodeURIComponent(slug)}/assets`, { body }),

  /** A title's own audit trail — readable by staff or its owning group. */
  auditTrail: (slug: string, signal?: AbortSignal): Promise<CatalogueAuditTrail> =>
    http.get<CatalogueAuditTrail>(
      `/catalogue/anime/${encodeURIComponent(slug)}/audit`,
      signal === undefined ? {} : { signal },
    ),

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

  /** Mirrors `updateAnime`: a non-owning editor gets `ProposeAnimeEditResponse` instead of `{ id }`. */
  updateEpisode: (
    episodeId: string,
    body: EpisodeEditBody,
  ): Promise<{ id: string } | ProposeAnimeEditResponse> =>
    http.patch<{ id: string } | ProposeAnimeEditResponse>(
      `/catalogue/episodes/${encodeURIComponent(episodeId)}`,
      { body },
    ),

  /** Soft delete: watch progress and comments keep their referent. */
  deleteEpisode: (episodeId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/catalogue/episodes/${encodeURIComponent(episodeId)}`),

  /* ------------------------------------------------------------------ */
  /* Cross-group edit proposals                                          */
  /* ------------------------------------------------------------------ */

  /** Staff-only: every pending proposal awaiting a decision. */
  proposalQueue: (signal?: AbortSignal): Promise<CatalogueProposalQueue> =>
    http.get<CatalogueProposalQueue>('/catalogue/proposals', signal === undefined ? {} : { signal }),

  decideProposal: (proposalId: string, body: CatalogueProposalDecisionBody): Promise<{ success: boolean }> =>
    http.post<{ success: boolean }>(
      `/catalogue/proposals/${encodeURIComponent(proposalId)}/decision`,
      { body },
    ),

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
