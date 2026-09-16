import type {
  ContinueWatchingResponse,
  EpisodeProgress,
  LibraryEntry,
  LibraryPage,
  LibraryQuery,
  LibraryUpsertBody,
  ProgressUpsertBody,
} from '@playanime/contracts';
import { http, type QueryParams } from './client';

/**
 * Library and playback progress.
 *
 * Progress is stored server-side, so it follows the viewer across devices.
 * There is deliberately no local mirror: a browser-local copy would diverge and
 * then overwrite the server's record on the next write.
 */
export const libraryApi = {
  list: (query: LibraryQuery = {}, signal?: AbortSignal): Promise<LibraryPage> =>
    http.get<LibraryPage>('/library', {
      query: query as QueryParams,
      ...(signal === undefined ? {} : { signal }),
    }),

  save: (animeId: string, body: LibraryUpsertBody): Promise<LibraryEntry> =>
    http.put<LibraryEntry>(`/library/${encodeURIComponent(animeId)}`, { body }),

  remove: (animeId: string): Promise<{ success: boolean }> =>
    http.delete<{ success: boolean }>(`/library/${encodeURIComponent(animeId)}`),

  saveProgress: (episodeId: string, body: ProgressUpsertBody): Promise<EpisodeProgress> =>
    http.put<EpisodeProgress>(`/progress/${encodeURIComponent(episodeId)}`, { body }),

  getProgress: (episodeId: string, signal?: AbortSignal): Promise<EpisodeProgress | null> =>
    http.get<EpisodeProgress | null>(
      `/progress/${encodeURIComponent(episodeId)}`,
      signal === undefined ? {} : { signal },
    ),

  continueWatching: (signal?: AbortSignal): Promise<ContinueWatchingResponse> =>
    http.get<ContinueWatchingResponse>('/continue-watching', signal === undefined ? {} : { signal }),
};
