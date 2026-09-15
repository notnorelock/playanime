import { createResource, For, Show, Suspense, type JSX } from 'solid-js';
import { useParams } from '@solidjs/router';
import Star from 'lucide-solid/icons/star';
import Calendar from 'lucide-solid/icons/calendar';
import Clapperboard from 'lucide-solid/icons/clapperboard';
import ListPlus from 'lucide-solid/icons/list-plus';
import { Badge, Button, Skeleton, Spinner, cn } from '@playanime/ui';
import { getAnime, listEpisodes } from '~/features/anime/services/anime.service.js';
import {
  displayTitle,
  episodeCountLabel,
  formatLabel,
  formatRating,
  seasonAndYear,
  secondaryTitle,
  statusLabel,
} from '~/features/anime/utils/display.js';

/**
 * Title detail.
 *
 * The poster is the anchor and stays a rectangle at full fidelity — cropping it
 * into a banner, which is the conventional move, discards the artwork the
 * studio actually produced for this shape.
 */
export function AnimeDetailPage() {
  const params = useParams<{ slug: string }>();

  // Wrapped rather than passed directly: Solid calls the fetcher with
  // (source, ResourceFetcherInfo), and the service signature takes an
  // AbortSignal second. Passing it bare would type-error, and coercing it would
  // hand the info object to fetch() as a signal.
  const [anime] = createResource(
    () => params.slug,
    (slug: string) => getAnime(slug),
  );

  const [episodes] = createResource(
    () => params.slug,
    (slug: string) => listEpisodes(slug),
  );

  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Show when={anime()} keyed>
        {(title) => (
          <article class="container-page pb-16 pt-8">
            <div class="flex flex-col gap-8 md:flex-row md:gap-10">
              {/* --- Poster --- */}
              <div class="w-full max-w-[220px] shrink-0 self-center md:self-start">
                <Show
                  when={title.poster}
                  fallback={<div class="aspect-poster w-full rounded-md bg-ink-800" />}
                >
                  {(poster) => (
                    <img
                      src={poster().url}
                      alt={`Plakat: ${displayTitle(title)}`}
                      width={poster().width ?? undefined}
                      height={poster().height ?? undefined}
                      class="aspect-poster w-full rounded-md border border-ink-600 object-cover"
                    />
                  )}
                </Show>
              </div>

              {/* --- Detail --- */}
              <div class="flex min-w-0 flex-1 flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant={title.status === 'releasing' ? 'airing' : 'finished'}>
                      {statusLabel(title.status)}
                    </Badge>
                    <Badge variant="neutral">{formatLabel(title.format)}</Badge>
                  </div>

                  <h1 class="font-display text-3xl font-bold tracking-tighter text-paper sm:text-4xl">
                    {displayTitle(title)}
                  </h1>

                  <Show when={secondaryTitle(title)}>
                    {(second) => <p class="text-sm text-slate-500">{second()}</p>}
                  </Show>
                </div>

                {/* --- Facts. Each is present only when known; an unknown value
                        is omitted rather than shown as a dash. --- */}
                <dl class="flex flex-wrap gap-x-8 gap-y-3">
                  <Show when={formatRating(title.averageRating)}>
                    {(rating) => (
                      <Fact label="Ocena" icon={<Star class="size-3.5 fill-amber-400 text-amber-400" />}>
                        <span class="tabular text-lg font-semibold text-paper">{rating()}</span>
                        <span class="text-xs text-slate-500">/ 10</span>
                      </Fact>
                    )}
                  </Show>

                  <Show when={seasonAndYear(title)}>
                    {(season) => (
                      <Fact label="Sezon" icon={<Calendar class="size-3.5 text-slate-400" />}>
                        <span class="text-sm text-paper">{season()}</span>
                      </Fact>
                    )}
                  </Show>

                  <Show when={episodeCountLabel(title.episodeCount)}>
                    {(count) => (
                      <Fact label="Odcinki" icon={<Clapperboard class="size-3.5 text-slate-400" />}>
                        <span class="tabular text-sm text-paper">{count()}</span>
                      </Fact>
                    )}
                  </Show>
                </dl>

                <Show when={title.genres.length > 0}>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={title.genres}>
                      {(genre) => <Badge variant="outline">{genre.name}</Badge>}
                    </For>
                  </div>
                </Show>

                <div class="flex flex-wrap gap-2">
                  <Button variant="primary">
                    <ListPlus />
                    Dodaj do listy
                  </Button>
                  <Button variant="outline">Oceń</Button>
                </div>
              </div>
            </div>

            {/* --- Episodes --- */}
            <section class="mt-14">
              <h2 class="mb-4 font-display text-xl font-semibold text-paper">Odcinki</h2>

              <Suspense fallback={<Spinner />}>
                <Show
                  when={episodes()}
                  fallback={<p class="text-sm text-slate-400">Brak listy odcinków.</p>}
                >
                  {(list) => (
                    <Show
                      when={list().length > 0}
                      fallback={
                        <div class="rounded-md border border-dashed border-ink-600 px-6 py-10 text-center">
                          <p class="text-sm text-slate-400">
                            Lista odcinków nie jest jeszcze dostępna.
                          </p>
                        </div>
                      }
                    >
                      <ul class="flex flex-col divide-y divide-ink-600 rounded-md border border-ink-600">
                        <For each={list()}>
                          {(episode) => (
                            <li
                              class={cn(
                                'flex items-center gap-4 px-4 py-3',
                                'transition-colors duration-[120ms] hover:bg-ink-800',
                              )}
                            >
                              <span class="tabular w-8 shrink-0 text-sm text-slate-500">
                                {episode.number}
                              </span>
                              <span class="min-w-0 flex-1 truncate text-sm text-paper">
                                {episode.titlePolish ?? episode.title ?? `Odcinek ${String(episode.number)}`}
                              </span>
                              <Show when={episode.isFiller}>
                                <Badge size="sm" variant="neutral">
                                  Filler
                                </Badge>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  )}
                </Show>
              </Suspense>
            </section>
          </article>
        )}
      </Show>
    </Suspense>
  );
}

function Fact(props: {
  label: string;
  icon: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-1">
      <dt class="eyebrow flex items-center gap-1.5">
        {props.icon}
        {props.label}
      </dt>
      <dd class="flex items-baseline gap-1">{props.children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div class="container-page flex flex-col gap-8 pt-8 md:flex-row md:gap-10">
      <Skeleton class="aspect-poster w-full max-w-[220px] shrink-0" />
      <div class="flex flex-1 flex-col gap-4">
        <Skeleton class="h-10 w-3/4" />
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-20 w-full" />
      </div>
    </div>
  );
}
