import type { AnimeDetail } from '@playanime/contracts';
import Calendar from 'lucide-solid/icons/calendar';
import Clock from 'lucide-solid/icons/clock';
import Star from 'lucide-solid/icons/star';
import { Badge } from '@playanime/ui';
import { For, Show, type JSX } from 'solid-js';
import {
  displayTitle,
  episodeCountLabel,
  formatLabel,
  formatRating,
  seasonAndYear,
  secondaryTitle,
  statusLabel,
} from '~/features/anime/utils/display.js';

const AGE_LABELS: Readonly<Record<NonNullable<AnimeDetail['ageRating']>, string>> = {
  g: 'G',
  pg: 'PG',
  pg_13: 'PG-13',
  r_17: 'R-17',
  r_plus: 'R+',
  rx: 'RX',
};

function dateRange(title: AnimeDetail): string | null {
  if (title.startDate === null) return null;
  const format = (date: string) =>
    new Intl.DateTimeFormat('pl-PL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${date}T00:00:00`));
  return title.endDate === null
    ? `Od ${format(title.startDate)}`
    : `${format(title.startDate)} – ${format(title.endDate)}`;
}

export function DetailHero(props: { anime: AnimeDetail }) {
  return (
    <header class="relative isolate overflow-hidden border-b border-ink-600">
      <Show when={props.anime.banner}>
        {(banner) => (
          <div
            class="absolute inset-0 -z-20 bg-cover bg-center opacity-50"
            style={{ 'background-image': `url("${banner().url}")` }}
          />
        )}
      </Show>
      <div class="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgba(9,11,18,.25),#0d1018_92%),linear-gradient(to_right,#0d1018_4%,transparent_70%)]" />

      <div class="container-page grid min-h-[32rem] items-end gap-8 pb-10 pt-24 md:grid-cols-[240px_1fr] md:gap-10">
        <div class="mx-auto w-full max-w-[240px] md:mx-0">
          <Show
            when={props.anime.poster}
            fallback={<div class="aspect-poster rounded-xl border border-ink-600 bg-ink-800" />}
          >
            {(poster) => (
              <img
                src={poster().url}
                alt={`Plakat: ${displayTitle(props.anime)}`}
                width={poster().width ?? undefined}
                height={poster().height ?? undefined}
                class="aspect-poster w-full rounded-xl border border-paper/15 object-cover shadow-2xl"
              />
            )}
          </Show>
        </div>

        <div class="max-w-4xl space-y-5">
          <div class="flex flex-wrap gap-2">
            <Badge variant={props.anime.status === 'releasing' ? 'airing' : 'neutral'}>
              {statusLabel(props.anime.status)}
            </Badge>
            <Badge variant="outline">{formatLabel(props.anime.format)}</Badge>
            <Show when={props.anime.ageRating}>
              {(rating) => <Badge variant="outline">{AGE_LABELS[rating()]}</Badge>}
            </Show>
          </div>

          <div>
            <h1 class="max-w-3xl font-display text-4xl font-black tracking-tighter text-paper sm:text-5xl lg:text-6xl">
              {displayTitle(props.anime)}
            </h1>
            <Show when={secondaryTitle(props.anime)}>
              {(title) => <p class="mt-2 text-sm text-slate-400 sm:text-base">{title()}</p>}
            </Show>
          </div>

          <dl class="flex flex-wrap gap-x-7 gap-y-3 text-sm">
            <Show when={formatRating(props.anime.averageRating)}>
              {(rating) => (
                <Fact icon={<Star class="size-4 fill-amber-400 text-amber-400" />}>
                  <strong class="text-paper">{rating()}</strong>
                  <span class="text-slate-500">/ 10</span>
                </Fact>
              )}
            </Show>
            <Show when={seasonAndYear(props.anime)}>
              {(season) => <Fact icon={<Calendar class="size-4" />}>{season()}</Fact>}
            </Show>
            <Show when={episodeCountLabel(props.anime.episodeCount)}>
              {(count) => <Fact>{count()}</Fact>}
            </Show>
            <Show when={props.anime.durationMinutes}>
              {(duration) => (
                <Fact icon={<Clock class="size-4" />}>{duration()} min / odcinek</Fact>
              )}
            </Show>
          </dl>

          <Show when={props.anime.genres.length > 0}>
            <div class="flex flex-wrap gap-2">
              <For each={props.anime.genres}>
                {(genre) => <Badge variant="outline">{genre.name}</Badge>}
              </For>
            </div>
          </Show>

          <Show when={props.anime.synopsis}>
            {(synopsis) => (
              <p class="max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                {synopsis()}
              </p>
            )}
          </Show>

          <div class="flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-400">
            <Show when={props.anime.studios.length > 0}>
              <p>
                <span class="text-slate-500">Studio: </span>
                {props.anime.studios.map((studio) => studio.name).join(', ')}
              </p>
            </Show>
            <Show when={dateRange(props.anime)}>
              {(range) => (
                <p>
                  <span class="text-slate-500">Emisja: </span>
                  {range()}
                </p>
              )}
            </Show>
          </div>
        </div>
      </div>
    </header>
  );
}

function Fact(props: { icon?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="flex items-center gap-1.5 text-slate-300">
      {props.icon}
      <dd class="flex items-baseline gap-1">{props.children}</dd>
    </div>
  );
}
