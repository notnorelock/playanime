import type {
  AnimeDetail,
  CommentPage,
  LibraryEntry,
  LibraryPage,
  LibraryUpsertBody,
  Rating,
  RatingUpsertBody,
} from '@playanime/contracts';
import { ApiError, api } from '~/services/api-client.js';

export interface ViewerAnimeState {
  rating: Rating | null;
  libraryEntry: LibraryEntry | null;
}

export function getAnimeDetail(slug: string, signal?: AbortSignal): Promise<AnimeDetail> {
  return api.get<AnimeDetail>(`/anime/${encodeURIComponent(slug)}`, { signal });
}

export function listAnimeReviews(
  animeId: string,
  signal?: AbortSignal,
): Promise<CommentPage> {
  return api.get<CommentPage>(`/anime/${encodeURIComponent(animeId)}/reviews`, {
    query: { limit: 12 },
    signal,
  });
}

async function getCurrentRating(animeId: string): Promise<Rating | null> {
  try {
    return await api.get<Rating | null>(`/anime/${encodeURIComponent(animeId)}/rating`);
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) return null;
    throw error;
  }
}

async function findLibraryEntry(animeId: string): Promise<LibraryEntry | null> {
  let cursor: string | undefined;

  try {
    do {
      const page = await api.get<LibraryPage>('/library', {
        query: { limit: 100, cursor },
      });
      const entry = page.items.find((item) => item.anime.id === animeId);
      if (entry !== undefined) return entry;
      cursor = page.nextCursor ?? undefined;
      if (!page.hasMore) return null;
    } while (cursor !== undefined);
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthenticated) return null;
    throw error;
  }

  return null;
}

export async function getViewerAnimeState(animeId: string): Promise<ViewerAnimeState> {
  const [rating, libraryEntry] = await Promise.all([
    getCurrentRating(animeId),
    findLibraryEntry(animeId),
  ]);
  return { rating, libraryEntry };
}

export function saveAnimeRating(animeId: string, score: number): Promise<Rating> {
  const body: RatingUpsertBody = { score };
  return api.put<Rating>(`/anime/${encodeURIComponent(animeId)}/rating`, body);
}

export function saveLibraryStatus(
  animeId: string,
  body: LibraryUpsertBody,
): Promise<unknown> {
  return api.put<unknown>(`/library/${encodeURIComponent(animeId)}`, body);
}
