import { ref, shallowRef } from 'vue';
import type { AnimeListQuery } from '@playanime/contracts';
import { AbortError, animeApi } from '@/api';
import { toAnimeCardModel, type AnimeCardModel } from '@/models';

/**
 * Cursor-paginated catalogue listing.
 *
 * The backend paginates by cursor, not page number, so there is no total count
 * and no page index — `loadMore` follows `nextCursor` until `hasMore` is false.
 * Filtering and sorting are query parameters, resolved against database
 * indexes; the browser never receives more rows than it displays.
 */
export function useAnimeCatalogue() {
  const items = shallowRef<AnimeCardModel[]>([]);
  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const hasMore = ref(false);
  const error = ref<Error | null>(null);

  let cursor: string | null = null;
  let currentQuery: AnimeListQuery = {};
  let controller: AbortController | null = null;

  /** Replaces the listing with the first page for `query`. */
  async function load(query: AnimeListQuery = {}): Promise<void> {
    controller?.abort();
    const request = new AbortController();
    controller = request;

    currentQuery = query;
    cursor = null;
    isLoading.value = true;
    error.value = null;

    try {
      const page = await animeApi.list(query, request.signal);
      if (request.signal.aborted) return;

      items.value = page.items.map((item) => toAnimeCardModel(item));
      cursor = page.nextCursor;
      hasMore.value = page.hasMore;
    } catch (cause: unknown) {
      if (AbortError.is(cause)) return;
      items.value = [];
      hasMore.value = false;
      error.value = cause instanceof Error ? cause : new Error('Nie udało się wczytać katalogu.');
    } finally {
      if (controller === request) {
        isLoading.value = false;
        controller = null;
      }
    }
  }

  /** Appends the next page. A no-op while a request is already running. */
  async function loadMore(): Promise<void> {
    if (!hasMore.value || cursor === null || isLoadingMore.value || isLoading.value) return;

    isLoadingMore.value = true;

    try {
      const page = await animeApi.list({ ...currentQuery, cursor });
      items.value = [...items.value, ...page.items.map((item) => toAnimeCardModel(item))];
      cursor = page.nextCursor;
      hasMore.value = page.hasMore;
    } catch (cause: unknown) {
      if (!AbortError.is(cause)) {
        error.value = cause instanceof Error ? cause : new Error('Nie udało się wczytać kolejnej strony.');
      }
    } finally {
      isLoadingMore.value = false;
    }
  }

  function dispose(): void {
    controller?.abort();
    controller = null;
  }

  return { items, isLoading, isLoadingMore, hasMore, error, load, loadMore, dispose };
}
