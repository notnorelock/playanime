import type {
  AnimeDetail,
  CommentPage,
  WatchStatus,
} from '@playanime/contracts';
import Star from 'lucide-solid/icons/star';
import { Avatar, Badge, Button, Select, Spinner } from '@playanime/ui';
import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
} from 'solid-js';
import {
  getViewerAnimeState,
  listAnimeReviews,
  saveAnimeRating,
  saveLibraryStatus,
} from '../services/detail.service.js';

const LIBRARY_OPTIONS: readonly { value: WatchStatus; label: string }[] = [
  { value: 'watching', label: 'Oglądam' },
  { value: 'planned', label: 'Planuję obejrzeć' },
  { value: 'completed', label: 'Ukończone' },
  { value: 'paused', label: 'Wstrzymane' },
  { value: 'dropped', label: 'Porzucone' },
];

const RATING_OPTIONS = Array.from({ length: 10 }, (_, index) => ({
  value: String(index + 1),
  label: `${String(index + 1)} / 10`,
}));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Nie udało się zapisać zmiany.';
}

export function EngagementPanel(props: { anime: AnimeDetail }) {
  const [reviews] = createResource(
    () => props.anime.id,
    (animeId): Promise<CommentPage> => listAnimeReviews(animeId),
  );
  const [viewer] = createResource(
    () => props.anime.id,
    (animeId) => getViewerAnimeState(animeId),
  );
  const [libraryStatus, setLibraryStatus] = createSignal<WatchStatus>();
  const [rating, setRating] = createSignal<number>();
  const [savingLibrary, setSavingLibrary] = createSignal(false);
  const [savingRating, setSavingRating] = createSignal(false);
  const [message, setMessage] = createSignal<string>();

  createEffect(() => {
    const state = viewer();
    setLibraryStatus(state?.libraryEntry?.status);
    setRating(state?.rating?.score);
  });

  const changeLibrary = async (status: WatchStatus | null) => {
    if (status === null) return;
    setSavingLibrary(true);
    setMessage(undefined);
    try {
      await saveLibraryStatus(props.anime.id, { status });
      setLibraryStatus(status);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSavingLibrary(false);
    }
  };

  const changeRating = async (value: string | null) => {
    if (value === null) return;
    const score = Number(value);
    setSavingRating(true);
    setMessage(undefined);
    try {
      const saved = await saveAnimeRating(props.anime.id, score);
      setRating(saved.score);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSavingRating(false);
    }
  };

  return (
    <section class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div>
        <div class="mb-5 flex items-end justify-between gap-4">
          <div>
            <p class="eyebrow mb-1">Społeczność</p>
            <h2 class="font-display text-2xl font-bold text-paper">Recenzje</h2>
          </div>
          <Show when={props.anime.ratingCount > 0}>
            <p class="text-xs text-slate-500">
              {props.anime.ratingCount.toLocaleString('pl-PL')} ocen
            </p>
          </Show>
        </div>

        <Show when={!reviews.loading} fallback={<Spinner />}>
          <Show
            when={reviews()?.items}
            fallback={<p class="text-sm text-slate-400">Nie udało się pobrać recenzji.</p>}
          >
            {(items) => (
              <Show
                when={items().length > 0}
                fallback={
                  <div class="rounded-xl border border-dashed border-ink-600 bg-ink-850 p-8 text-center text-sm text-slate-400">
                    Brak opublikowanych recenzji.
                  </div>
                }
              >
                <div class="grid gap-3 md:grid-cols-2">
                  <For each={items()}>
                    {(review) => {
                      const authorName = review.author.displayName ?? review.author.username;
                      return (
                        <article class="rounded-xl border border-ink-600 bg-ink-850 p-5">
                          <header class="mb-4 flex items-center gap-3">
                            <Avatar
                              src={review.author.avatar}
                              name={authorName}
                              size="sm"
                            />
                            <div class="min-w-0 flex-1">
                              <p class="truncate text-sm font-semibold text-paper">{authorName}</p>
                              <time class="text-xs text-slate-500" dateTime={review.createdAt}>
                                {new Intl.DateTimeFormat('pl-PL', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                }).format(new Date(review.createdAt))}
                              </time>
                            </div>
                            <Show when={review.rating}>
                              {(score) => (
                                <Badge variant="neutral">
                                  <Star class="size-3 fill-amber-400 text-amber-400" />
                                  {score()}/10
                                </Badge>
                              )}
                            </Show>
                          </header>
                          <Show
                            when={review.hasSpoilers}
                            fallback={<p class="whitespace-pre-line text-sm leading-6 text-slate-300">{review.body}</p>}
                          >
                            <details>
                              <summary class="cursor-pointer text-sm font-medium text-amber-400">
                                Recenzja zawiera spoilery
                              </summary>
                              <p class="mt-3 whitespace-pre-line text-sm leading-6 text-slate-300">
                                {review.body}
                              </p>
                            </details>
                          </Show>
                        </article>
                      );
                    }}
                  </For>
                </div>
              </Show>
            )}
          </Show>
        </Show>
      </div>

      <aside class="h-fit space-y-5 rounded-xl border border-ink-600 bg-ink-850 p-5 lg:sticky lg:top-24">
        <div>
          <h2 class="font-display text-lg font-bold text-paper">Twoje anime</h2>
          <p class="mt-1 text-xs leading-5 text-slate-500">
            Zapis listy i oceny wymaga zalogowania.
          </p>
        </div>

        <Select<WatchStatus>
          label="Status na liście"
          options={LIBRARY_OPTIONS}
          value={libraryStatus()}
          disabled={savingLibrary()}
          placeholder="Dodaj do listy"
          onChange={(value) => void changeLibrary(value)}
        />

        <Select
          label="Twoja ocena"
          options={RATING_OPTIONS}
          value={rating() === undefined ? undefined : String(rating())}
          disabled={savingRating()}
          placeholder="Wybierz ocenę"
          onChange={(value) => void changeRating(value)}
        />

        <Show when={message()}>
          {(text) => <p class="text-xs leading-5 text-rose-400">{text()}</p>}
        </Show>

        <Show when={viewer.loading}>
          <Button variant="ghost" size="sm" disabled>
            <Spinner size="sm" />
            Wczytywanie…
          </Button>
        </Show>
      </aside>
    </section>
  );
}
