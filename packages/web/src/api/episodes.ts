import type {
  EpisodeSourceListResponse,
  EpisodeWatchBootstrap,
  SourcePlaybackResponse,
} from '@playanime/contracts';
import { http } from './client';

/**
 * Episode playback.
 *
 * `bootstrap` is one request that returns the episode, its title, the adjacent
 * episode ids, the viewer's progress and the available sources. The watch page
 * therefore renders from a single round trip instead of the chain of dependent
 * requests the previous frontend issued.
 *
 * Note what is absent: nothing here constructs a provider URL, and no provider
 * name appears in this file. The frontend asks for a `PlaybackDescriptor` and
 * renders whatever variant it receives — provider extraction lives on the
 * server, in `@playanime/external-media`, and may never leak into the client.
 */
export const episodesApi = {
  bootstrap: (episodeId: string, signal?: AbortSignal): Promise<EpisodeWatchBootstrap> =>
    http.get<EpisodeWatchBootstrap>(
      `/episodes/${encodeURIComponent(episodeId)}`,
      signal === undefined ? {} : { signal },
    ),

  sources: (episodeId: string, signal?: AbortSignal): Promise<EpisodeSourceListResponse> =>
    http.get<EpisodeSourceListResponse>(
      `/episodes/${encodeURIComponent(episodeId)}/sources`,
      signal === undefined ? {} : { signal },
    ),

  /** Resolves playback for an episode, optionally pinned to one source. */
  playback: (
    episodeId: string,
    sourceId?: string,
    signal?: AbortSignal,
  ): Promise<SourcePlaybackResponse> =>
    http.get<SourcePlaybackResponse>(`/episodes/${encodeURIComponent(episodeId)}/playback`, {
      ...(sourceId === undefined ? {} : { query: { sourceId } }),
      ...(signal === undefined ? {} : { signal }),
    }),

  /**
   * Re-resolves one source.
   *
   * `refresh` bypasses the server-side cache, which is what a player needs when
   * a temporary signed URL expires mid-playback.
   */
  sourcePlayback: (
    sourceId: string,
    options: { refresh?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<SourcePlaybackResponse> =>
    http.get<SourcePlaybackResponse>(`/sources/${encodeURIComponent(sourceId)}/playback`, {
      ...(options.refresh === true ? { query: { refresh: '1' } } : {}),
      ...(signal === undefined ? {} : { signal }),
    }),
};
