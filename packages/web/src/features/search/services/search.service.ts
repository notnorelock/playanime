import type { AnimePage } from '@playanime/contracts';
import { listAnime } from '~/features/anime/services/anime.service.js';

export const MIN_SEARCH_LENGTH = 2;

/** Shared by the search route and the shell-owned search overlay. */
export function searchAnime(
  query: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<AnimePage> {
  const search = query.trim();
  if (search.length < MIN_SEARCH_LENGTH) {
    return Promise.resolve({ items: [], nextCursor: null, hasMore: false });
  }
  return listAnime({ search, sort: 'popularity', limit }, signal);
}
