import { A } from '@solidjs/router';
import { Show, For } from 'solid-js';
import Star from 'lucide-solid/icons/star';
import type { AnimeSummary } from '@playanime/contracts';
import { cn } from '@playanime/ui';
import { Artwork } from './Artwork.js';
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
  variant?: 'poster' | 'landscape' | 'compact';
  /** Backwards-compatible shorthand used by existing rails. */
  compact?: boolean;
}

export function AnimeCard(props: AnimeCardProps) {
  const variant = () => props.variant ?? (props.compact === true ? 'compact' : 'poster');
  const isAiring = () => props.anime.status === 'releasing';
  const rating = () => formatRating(props.anime.averageRating);
  const second = () => secondaryTitle(props.anime);

  if (variant() === 'compact') {
    return (
      <A
        href={`/anime/${props.anime.slug}`}
        class={cn(
          'group flex min-w-0 items-center gap-3 rounded-md border border-ink-600 bg-ink-850 p-2',
          'transition-colors hover:border-ink-500 hover:bg-ink-800',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        )}
      >
        <Artwork
          image={props.anime.poster}
          class="aspect-poster w-12 shrink-0 rounded-sm"
          imageClass="transition-transform duration-200 group-hover:scale-[1.03]"
        />
        <div class="min-w-0 flex-1">
          <h3 class="truncate text-sm font-medium text-paper group-hover:text-amber-300">
            {displayTitle(props.anime)}
          </h3>
          <p class="mt-1 truncate text-xs text-slate-400">
            {formatLabel(props.anime.format)}
            <Show when={seasonAndYear(props.anime)}>
              {(season) => ` · ${season()}`}
            </Show>
          </p>
        </div>
        <Show when={rating()}>
          {(value) => (
            <span class="tabular shrink-0 text-xs text-amber-400" aria-label={`Ocena ${value()} na 10`}>
              {value()}
            </span>
          )}
        </Show>
      </A>
    );
  }

  if (variant() === 'landscape') {
    return (
      <A
        href={`/anime/${props.anime.slug}`}
        class={cn(
          'group block overflow-hidden rounded-md border border-ink-600 bg-ink-850',
          'transition-colors hover:border-ink-500',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        )}
      >
        <Artwork
          image={props.anime.poster}
          class="aspect-video w-full border-b border-ink-600"
          imageClass="transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <div class="p-3">
          <div class="flex items-start justify-between gap-3">
            <h3 class="clamp-2 font-display text-base font-semibold leading-snug text-paper group-hover:text-amber-300">
              {displayTitle(props.anime)}
            </h3>
            <Show when={rating()}>
              {(value) => (
                <span class="tabular flex shrink-0 items-center gap-1 text-xs text-amber-400">
                  <Star class="size-3 fill-current" aria-hidden="true" />
                  {value()}
                </span>
              )}
            </Show>
          </div>
          <p class="mt-2 truncate text-xs text-slate-400">
            {formatLabel(props.anime.format)}
            <Show when={seasonAndYear(props.anime)}>
              {(season) => ` · ${season()}`}
            </Show>
          </p>
        </div>
      </A>
    );
  }

  return (
    <A
      href={`/anime/${props.anime.slug}`}
      class={cn(
        'group flex flex-col gap-2.5 rounded-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-900',
        'w-full',
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
        <Artwork
          image={props.anime.poster}
          class="size-full"
          fallback={
            <div class="flex size-full items-center justify-center p-3">
              <span class="clamp-3 text-center text-xs text-slate-500">
                {displayTitle(props.anime)}
              </span>
            </div>
          }
        />

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
            'text-base',
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

        <Show when={props.anime.genres.length > 0}>
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
