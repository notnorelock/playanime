import { createResource, For, Show, Suspense, type JSX } from 'solid-js';
import { A } from '@solidjs/router';
import ArrowRight from 'lucide-solid/icons/arrow-right';
import Radio from 'lucide-solid/icons/radio';
import { SkeletonCard, cn } from '@playanime/ui';
import { AnimeCard } from '~/features/anime/components/AnimeCard.js';
import { CourRibbon } from '~/features/discovery/components/CourRibbon.js';
import { listAnime } from '~/features/anime/services/anime.service.js';
import { seasonLabel } from '~/features/anime/utils/display.js';
import type { SeasonOfYear } from '@playanime/contracts';

/**
 * Home page.
 *
 * Organized around the broadcast season rather than an infinite popularity
 * grid. The hero is not a marketing statement — it is the current cour and how
 * far into it we are, which is the thing a returning viewer opens the site to
 * check.
 */

/** Derives the current broadcast season from the date. */
function currentSeason(now = new Date()): { season: SeasonOfYear; year: number; startDate: Date } {
  const month = now.getMonth();
  const year = now.getFullYear();

  // Anime seasons begin in January, April, July and October.
  if (month < 3) return { season: 'winter', year, startDate: new Date(year, 0, 1) };
  if (month < 6) return { season: 'spring', year, startDate: new Date(year, 3, 1) };
  if (month < 9) return { season: 'summer', year, startDate: new Date(year, 6, 1) };
  return { season: 'fall', year, startDate: new Date(year, 9, 1) };
}

export function HomePage() {
  const season = currentSeason();

  const [airing] = createResource(() =>
    listAnime({ status: 'releasing', sort: 'popularity', limit: 12 }),
  );
  const [popular] = createResource(() => listAnime({ sort: 'popularity', limit: 12 }));
  const [topRated] = createResource(() => listAnime({ sort: 'rating', limit: 6 }));

  return (
    <div class="container-page pb-16 pt-10">
      {/* --- Hero: the current cour ------------------------------------- */}
      <section class="mb-16">
        <div class="flex flex-col gap-5 border-l-2 border-amber-400 pl-5 sm:pl-6">
          <div class="flex items-center gap-2">
            <Radio class="size-3.5 text-amber-400" aria-hidden="true" />
            <span class="eyebrow text-amber-400">Trwa teraz</span>
          </div>

          <h1 class="font-display text-4xl font-bold tracking-tighter text-paper sm:text-5xl">
            {seasonLabel(season.season)}{' '}
            <span class="tabular text-slate-500">{season.year}</span>
          </h1>

          <div class="max-w-md">
            <CourRibbon startDate={season.startDate} />
          </div>

          <p class="measure text-sm leading-normal text-slate-400">
            Baza anime, listy i społeczność po polsku. Śledź, co aktualnie leci, prowadź własne listy
            i sprawdzaj, gdzie legalnie obejrzeć każdy odcinek.
          </p>
        </div>
      </section>

      {/* --- Currently airing -------------------------------------------- */}
      <Section
        title="Emitowane w tym sezonie"
        href="/katalog?status=releasing"
        accent
      >
        <Suspense fallback={<CardGridSkeleton count={6} />}>
          <Show when={airing()} keyed>
            {(page) => (
              <Show
                when={page.items.length > 0}
                fallback={<EmptyState message="Brak tytułów emitowanych w tym sezonie." />}
              >
                <div class="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
                  <For each={page.items}>{(anime) => <AnimeCard anime={anime} />}</For>
                </div>
              </Show>
            )}
          </Show>
        </Suspense>
      </Section>

      {/* --- Popular ------------------------------------------------------ */}
      <Section title="Popularne" href="/katalog">
        <Suspense fallback={<CardGridSkeleton count={6} />}>
          <Show when={popular()} keyed>
            {(page) => (
              <Show
                when={page.items.length > 0}
                fallback={<EmptyState message="Katalog jest jeszcze pusty." />}
              >
                <div class="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
                  <For each={page.items}>{(anime) => <AnimeCard anime={anime} />}</For>
                </div>
              </Show>
            )}
          </Show>
        </Suspense>
      </Section>

      {/* --- Highest rated ------------------------------------------------ */}
      <Section title="Najwyżej oceniane" href="/katalog?sort=rating">
        <Suspense fallback={<CardGridSkeleton count={6} />}>
          <Show when={topRated()} keyed>
            {(page) => (
              <Show when={page.items.length > 0} fallback={<EmptyState message="Brak ocen." />}>
                <div class="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
                  <For each={page.items}>{(anime) => <AnimeCard anime={anime} />}</For>
                </div>
              </Show>
            )}
          </Show>
        </Suspense>
      </Section>
    </div>
  );
}

/** Section heading with an optional "see all" link. */
function Section(props: {
  title: string;
  href?: string;
  accent?: boolean;
  children: JSX.Element;
}) {
  return (
    <section class="mb-14">
      <div class="mb-5 flex items-baseline justify-between gap-4">
        <h2
          class={cn(
            'font-display text-xl font-semibold tracking-tight',
            props.accent === true ? 'text-paper' : 'text-paper',
          )}
        >
          {props.title}
        </h2>

        <Show when={props.href}>
          {(href) => (
            <A
              href={href()}
              class={cn(
                'group flex shrink-0 items-center gap-1 text-xs text-slate-400',
                'transition-colors duration-[120ms] hover:text-amber-400',
              )}
            >
              Zobacz wszystkie
              <ArrowRight
                class="size-3 transition-transform duration-[120ms] group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </A>
          )}
        </Show>
      </div>

      {props.children}
    </section>
  );
}

function CardGridSkeleton(props: { count: number }) {
  return (
    <div class="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
      <For each={Array.from({ length: props.count })}>{() => <SkeletonCard />}</For>
    </div>
  );
}

function EmptyState(props: { message: string }) {
  return (
    <div class="rounded-md border border-dashed border-ink-600 px-6 py-12 text-center">
      <p class="text-sm text-slate-400">{props.message}</p>
    </div>
  );
}
