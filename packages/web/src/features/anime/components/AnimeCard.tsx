import { A } from '@solidjs/router';
import { Show, For } from 'solid-js';
import Star from 'lucide-solid/icons/star';
import type { AnimeSummary } from '@playanime/contracts';
import { cn } from '@playanime/ui';
import {
  displayTitle,
  episodeCountLabel,
  formatLabel,
  formatRating,
  seasonAndYear,
  secondaryTitle,
} from '../utils/display.js';

/**
 * Catalogue card.
 *
 * Cards differ by state rather than being uniform tiles: a currently-airing
 * title carries an amber rule and its broadcast season, a finished one does
 * not. That irregularity is deliberate — the catalogue is not a uniform grid of
 * equivalent things, and flattening it into one loses the distinction a viewer
 * is actually scanning for.
 *
 * Hover is a border-colour shift, not a lift. A transform across a grid of
 * twenty cards causes reflow jitter and reads as a template.
 */
export interface AnimeCardProps {
  anime: AnimeSummary;
  /** Narrower card for horizontal rails. */
  compact?: boolean;
}

export function AnimeCard(props: AnimeCardProps) {
  const isAiring = () => props.anime.status === 'releasing';
  const rating = () => formatRating(props.anime.averageRating);
  const second = () => secondaryTitle(props.anime);

  return (
    <A
      href={`/anime/${props.anime.slug}`}
      class={cn(
        'group flex flex-col gap-2.5 rounded-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900',
        props.compact === true ? 'w-36 sm:w-40' : 'w-full',
      )}
    >
      <div
        class={cn(
          'relative aspect-poster overflow-hidden rounded-md',
          'bg-ink-800 border border-ink-600',
          'transition-colors duration-[120ms] ease-out',
          'group-hover:border-ink-500 group-focus-visible:border-amber-400',
        )}
      >
        <Show
          when={props.anime.poster}
          fallback={
            // No artwork: the title still needs to be identifiable, so it is
            // rendered rather than showing an empty box.
            <div class="flex size-full items-center justify-center p-3">
              <span class="text-center text-xs text-slate-500 clamp-3">
                {displayTitle(props.anime)}
              </span>
            </div>
          }
        >
          {(poster) => (
            <img
              src={poster().url}
              alt=""
              width={poster().width ?? undefined}
              height={poster().height ?? undefined}
              loading="lazy"
              decoding="async"
              class="size-full object-cover"
            />
          )}
        </Show>

        {/* Airing marker: a rule along the top edge rather than a floating
            badge, which would cover artwork. Amber means live, here as
            everywhere else. */}
        <Show when={isAiring()}>
          <span
            class="absolute inset-x-0 top-0 h-0.5 bg-amber-400"
            aria-hidden="true"
          />
        </Show>

        <Show when={rating()}>
          {(value) => (
            <div
              class={cn(
                'absolute bottom-1.5 right-1.5 flex items-center gap-1',
                'rounded-sm bg-ink-950/85 px-1.5 py-0.5 backdrop-blur-[2px]',
              )}
            >
              <Star class="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />
              <span class="tabular text-2xs font-medium text-paper">{value()}</span>
            </div>
          )}
        </Show>
      </div>

      <div class="flex flex-col gap-1">
        <h3
          class={cn(
            'font-display font-medium leading-snug text-paper clamp-2',
            'transition-colors duration-[120ms]',
            'group-hover:text-amber-300',
            props.compact === true ? 'text-sm' : 'text-base',
          )}
        >
          {displayTitle(props.anime)}
        </h3>

        <Show when={second()}>
          {(value) => <p class="text-xs text-slate-500 clamp-1">{value()}</p>}
        </Show>

        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-slate-400">
          <span>{formatLabel(props.anime.format)}</span>

          <Show when={isAiring() ? seasonAndYear(props.anime) : null}>
            {(season) => (
              <>
                <span class="text-ink-500" aria-hidden="true">
                  ·
                </span>
                <span class="text-amber-400">{season()}</span>
              </>
            )}
          </Show>

          <Show when={!isAiring() && episodeCountLabel(props.anime.episodeCount) !== null}>
            <span class="text-ink-500" aria-hidden="true">
              ·
            </span>
            <span class="tabular">{episodeCountLabel(props.anime.episodeCount)}</span>
          </Show>
        </div>

        <Show when={props.compact !== true && props.anime.genres.length > 0}>
          <div class="mt-0.5 flex flex-wrap gap-1">
            {/* Two genres is enough to characterize a title; more turns the
                card into a tag cloud. */}
            <For each={props.anime.genres.slice(0, 2)}>
              {(genre) => (
                <span class="rounded-xs border border-ink-600 px-1.5 py-0.5 text-2xs text-slate-400">
                  {genre.name}
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </A>
  );
}
