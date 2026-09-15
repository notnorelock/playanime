import type { EpisodeSummary } from '@playanime/contracts';
import { A } from '@solidjs/router';
import Play from 'lucide-solid/icons/play';
import { Badge } from '@playanime/ui';
import { For, Show } from 'solid-js';

function episodeTitle(episode: EpisodeSummary): string {
  return episode.titlePolish ?? episode.title ?? `Odcinek ${String(episode.number)}`;
}

function durationLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  return `${String(Math.round(seconds / 60))} min`;
}

export function EpisodeGrid(props: { episodes: readonly EpisodeSummary[] }) {
  return (
    <Show
      when={props.episodes.length > 0}
      fallback={
        <div class="rounded-xl border border-dashed border-ink-600 bg-ink-850 px-6 py-12 text-center text-sm text-slate-400">
          Lista odcinków nie jest jeszcze dostępna.
        </div>
      }
    >
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <For each={props.episodes}>
          {(episode) => (
            <A
              href={`/watch/${episode.id}`}
              class="group overflow-hidden rounded-xl border border-ink-600 bg-ink-850 transition duration-200 hover:-translate-y-0.5 hover:border-amber-400/60 hover:bg-ink-800 motion-reduce:transform-none motion-reduce:transition-none"
            >
              <div class="relative flex aspect-video items-center justify-center overflow-hidden bg-gradient-to-br from-ink-700 via-ink-850 to-ink-950">
                <span class="font-display text-5xl font-black text-paper/8">
                  {String(episode.number).padStart(2, '0')}
                </span>
                <span class="absolute inset-0 bg-gradient-to-t from-ink-950/90 to-transparent" />
                <span class="absolute bottom-3 left-3 flex size-9 items-center justify-center rounded-full bg-amber-400 text-ink-950 shadow-lg transition-transform group-hover:scale-105 motion-reduce:transition-none">
                  <Play class="ml-0.5 size-4 fill-current" aria-hidden="true" />
                </span>
                <Show when={durationLabel(episode.durationSeconds)}>
                  {(duration) => (
                    <span class="absolute bottom-3 right-3 rounded bg-ink-950/80 px-2 py-1 text-xs tabular-nums text-paper">
                      {duration()}
                    </span>
                  )}
                </Show>
              </div>
              <div class="space-y-2 p-4">
                <div class="flex items-start gap-3">
                  <span class="pt-0.5 text-xs font-semibold uppercase tracking-widest text-amber-400">
                    {episode.number}
                  </span>
                  <h3 class="line-clamp-2 text-sm font-semibold leading-snug text-paper">
                    {episodeTitle(episode)}
                  </h3>
                </div>
                <Show when={episode.synopsis}>
                  {(synopsis) => (
                    <p class="line-clamp-2 text-xs leading-relaxed text-slate-400">{synopsis()}</p>
                  )}
                </Show>
                <Show when={episode.isFiller || episode.isRecap}>
                  <div class="flex gap-1.5">
                    <Show when={episode.isFiller}>
                      <Badge size="sm" variant="neutral">Filler</Badge>
                    </Show>
                    <Show when={episode.isRecap}>
                      <Badge size="sm" variant="neutral">Podsumowanie</Badge>
                    </Show>
                  </div>
                </Show>
              </div>
            </A>
          )}
        </For>
      </div>
    </Show>
  );
}
