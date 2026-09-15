import { createResource, createSignal, For, Show, Suspense } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { Button, Select, SkeletonCard, Spinner } from '@playanime/ui';
import type { AnimeSummary, AnimeSort, ReleaseStatus } from '@playanime/contracts';
import { AnimeCard } from '~/features/anime/components/AnimeCard.js';
import { enumParam, firstParam } from '~/utils/search-params.js';
import { listAnime } from '~/features/anime/services/anime.service.js';

/**
 * Catalogue browse.
 *
 * Filters live in the URL rather than component state, so a filtered view is
 * shareable and survives a refresh — the behaviour a user expects from a
 * catalogue, and the thing that makes "send me that list" possible.
 *
 * Pagination appends rather than replacing: a viewer scanning for something
 * should not lose their place when loading more.
 */

const SORT_OPTIONS = [
  { value: 'popularity', label: 'Popularność' },
  { value: 'rating', label: 'Ocena' },
  { value: 'newest', label: 'Najnowsze' },
  { value: 'title', label: 'Tytuł' },
] as const;

const STATUS_OPTIONS = [
  { value: '', label: 'Każdy status' },
  { value: 'releasing', label: 'Emitowane' },
  { value: 'finished', label: 'Zakończone' },
  { value: 'not_yet_released', label: 'Zapowiedziane' },
] as const;

export function CataloguePage() {
  const [params, setParams] = useSearchParams();

  // Accumulated pages. Reset whenever a filter changes, since the cursor from
  // one filter set is meaningless under another.
  const [loaded, setLoaded] = createSignal<AnimeSummary[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);

  // Narrowed at the boundary: a hand-edited URL must not reach the API as an
  // unvalidated filter.
  const SORTS = ['popularity', 'rating', 'newest', 'title'] as const;
  const STATUSES = ['releasing', 'finished', 'not_yet_released', 'hiatus', 'cancelled'] as const;

  const sort = (): AnimeSort => enumParam<AnimeSort>(params['sort'], SORTS) ?? 'popularity';
  const status = (): ReleaseStatus | undefined =>
    enumParam<ReleaseStatus>(params['status'], STATUSES);
  const genre = (): string | undefined => firstParam(params['genre']);

  const [page] = createResource(
    () => ({ sort: sort(), status: status(), genre: genre() }),
    async (query) => {
      const result = await listAnime({ ...query, limit: 24 });
      setLoaded([...result.items]);
      setCursor(result.nextCursor);
      return result;
    },
  );

  const loadMore = async (): Promise<void> => {
    const next = cursor();
    if (next === null || loadingMore()) return;

    setLoadingMore(true);
    try {
      const result = await listAnime({
        sort: sort(),
        status: status(),
        genre: genre(),
        limit: 24,
        cursor: next,
      });

      setLoaded((previous) => [...previous, ...result.items]);
      setCursor(result.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div class="container-page pb-16 pt-8">
      <div class="mb-8 flex flex-col gap-5">
        <h1 class="font-display text-3xl font-bold tracking-tighter text-paper">Katalog</h1>

        <div class="flex flex-wrap items-end gap-3">
          <Select
            label="Sortowanie"
            size="sm"
            class="w-44"
            options={SORT_OPTIONS}
            value={sort()}
            onChange={(value) => {
              setParams({ sort: value ?? undefined });
            }}
          />

          <Select
            label="Status"
            size="sm"
            class="w-44"
            options={STATUS_OPTIONS}
            value={status() ?? ''}
            onChange={(value) => {
              setParams({ status: value === '' ? undefined : (value ?? undefined) });
            }}
          />
        </div>
      </div>

      <Suspense
        fallback={
          <div class="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
            <For each={Array.from({ length: 12 })}>{() => <SkeletonCard />}</For>
          </div>
        }
      >
        <Show when={page()}>
          <Show
            when={loaded().length > 0}
            fallback={
              <div class="rounded-md border border-dashed border-ink-600 px-6 py-16 text-center">
                <p class="text-sm text-slate-400">Nie znaleziono tytułów dla tych filtrów.</p>
              </div>
            }
          >
            <div class="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
              <For each={loaded()}>{(anime) => <AnimeCard anime={anime} />}</For>
            </div>

            <Show when={cursor() !== null}>
              <div class="mt-12 flex justify-center">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={loadingMore()}
                  onClick={() => {
                    void loadMore();
                  }}
                >
                  <Show when={loadingMore()} fallback="Pokaż więcej">
                    <Spinner size="sm" />
                    Ładowanie
                  </Show>
                </Button>
              </div>
            </Show>
          </Show>
        </Show>
      </Suspense>
    </div>
  );
}
