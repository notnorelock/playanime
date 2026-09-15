import type { CalendarEntry } from '@playanime/contracts';
import { A } from '@solidjs/router';
import Clock from 'lucide-solid/icons/clock';
import { Show } from 'solid-js';
import { cn } from '@playanime/ui';
import { Artwork } from './Artwork.js';
import { formatLabel } from '../utils/display.js';

export interface EpisodeCardProps {
  entry: CalendarEntry;
  variant?: 'episode' | 'calendar';
}

function episodeTitle(entry: CalendarEntry): string {
  return entry.episode.titlePolish ?? entry.episode.title ?? `Odcinek ${String(entry.episode.number)}`;
}

function durationLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  return `${String(Math.round(seconds / 60))} min`;
}

/** Episode and calendar cards share artwork and truthful episode metadata. */
export function EpisodeCard(props: EpisodeCardProps) {
  const calendar = () => props.variant === 'calendar';

  return (
    <A
      href={`/anime/${props.entry.anime.slug}`}
      class={cn(
        'group overflow-hidden rounded-md border border-ink-600 bg-ink-850',
        'transition-colors hover:border-ink-500 hover:bg-ink-800',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        calendar() ? 'flex min-h-28' : 'block',
      )}
    >
      <Artwork
        image={props.entry.anime.poster}
        class={calendar() ? 'w-20 shrink-0 border-r border-ink-600 sm:w-24' : 'aspect-video w-full'}
        imageClass="transition-transform duration-200 group-hover:scale-[1.03]"
      />
      <div class="flex min-w-0 flex-1 flex-col p-3">
        <div class="mb-1 flex items-center gap-2 text-2xs uppercase tracking-wide text-amber-400">
          <span>Odcinek {props.entry.episode.number}</span>
          <span aria-hidden="true">·</span>
          <span>{formatLabel(props.entry.anime.format)}</span>
        </div>
        <h3 class="truncate font-display text-sm font-semibold text-paper group-hover:text-amber-300">
          {props.entry.anime.title}
        </h3>
        <p class="mt-1 clamp-2 text-xs leading-relaxed text-slate-400">
          {episodeTitle(props.entry)}
        </p>
        <Show when={durationLabel(props.entry.episode.durationSeconds)}>
          {(duration) => (
            <span class="mt-auto flex items-center gap-1 pt-2 text-2xs text-slate-500">
              <Clock class="size-3" aria-hidden="true" />
              {duration()}
            </span>
          )}
        </Show>
      </div>
    </A>
  );
}
