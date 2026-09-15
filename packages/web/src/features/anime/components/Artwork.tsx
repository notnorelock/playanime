import type { ImageRef } from '@playanime/contracts';
import { cn } from '@playanime/ui';
import { Show, type JSX } from 'solid-js';

export interface ArtworkProps {
  image: ImageRef | null;
  alt?: string;
  loading?: 'eager' | 'lazy';
  class?: string;
  imageClass?: string;
  fallback?: JSX.Element;
}

/**
 * The single image boundary for anime artwork.
 *
 * Every domain card uses this primitive so dimensions, lazy loading and the
 * missing-artwork treatment stay consistent across poster and landscape
 * layouts.
 */
export function Artwork(props: ArtworkProps) {
  return (
    <div class={cn('relative overflow-hidden bg-ink-800', props.class)}>
      <Show
        when={props.image}
        fallback={
          props.fallback ?? (
            <div class="flex size-full items-center justify-center bg-ink-800" aria-hidden="true">
              <span class="font-display text-lg font-bold text-ink-500">PA</span>
            </div>
          )
        }
      >
        {(image) => (
          <img
            src={image().url}
            alt={props.alt ?? ''}
            width={image().width ?? undefined}
            height={image().height ?? undefined}
            loading={props.loading ?? 'lazy'}
            decoding="async"
            class={cn('size-full object-cover', props.imageClass)}
          />
        )}
      </Show>
    </div>
  );
}
