import { ref, shallowRef, watch, type Ref } from 'vue';
import { AbortError, animeApi } from '@/api';
import { toAnimeCardModel, type AnimeCardModel } from '@/models';

/**
 * Debounced catalogue search.
 *
 * Two separate protections, because they solve different problems:
 *
 * - The debounce stops a request per keystroke.
 * - Aborting the previous request stops a *slow earlier* response from landing
 *   after a fast later one and overwriting the results for the current query.
 *   Debouncing alone does not prevent that; it only makes it less frequent.
 */

const DEBOUNCE_MS = 300;
/** Below this, results are too broad to be useful and the query is skipped. */
const MIN_QUERY_LENGTH = 2;

export function useAnimeSearch(query: Ref<string>) {
  const results = shallowRef<AnimeCardModel[]>([]);
  const isLoading = ref(false);
  const hasSearched = ref(false);
  const error = ref<Error | null>(null);

  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function run(term: string): Promise<void> {
    controller?.abort();
    const request = new AbortController();
    controller = request;

    isLoading.value = true;
    error.value = null;

    try {
      const page = await animeApi.list({ search: term, limit: 24 }, request.signal);
      if (request.signal.aborted) return;

      results.value = page.items.map((item) => toAnimeCardModel(item));
      hasSearched.value = true;
    } catch (cause: unknown) {
      if (AbortError.is(cause)) return;
      results.value = [];
      error.value = cause instanceof Error ? cause : new Error('Wyszukiwanie nie powiodło się.');
    } finally {
      if (controller === request) {
        isLoading.value = false;
        controller = null;
      }
    }
  }

  watch(
    query,
    (value) => {
      if (timer !== null) clearTimeout(timer);

      const term = value.trim();

      if (term.length < MIN_QUERY_LENGTH) {
        // Cancel in flight too: clearing the box must clear the results, not
        // have them repopulated a moment later by a request already running.
        controller?.abort();
        controller = null;
        results.value = [];
        hasSearched.value = false;
        isLoading.value = false;
        return;
      }

      timer = setTimeout(() => {
        void run(term);
      }, DEBOUNCE_MS);
    },
    { immediate: true },
  );

  function dispose(): void {
    if (timer !== null) clearTimeout(timer);
    controller?.abort();
    controller = null;
  }

  return { results, isLoading, hasSearched, error, dispose };
}
