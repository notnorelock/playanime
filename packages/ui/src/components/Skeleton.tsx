import { splitProps } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Loading placeholder.
 *
 * Shaped to match what it replaces, so the layout does not shift when content
 * arrives. The shimmer is suppressed under prefers-reduced-motion: a looping
 * animation across a grid of twenty cards is exactly the kind of movement that
 * setting exists to stop.
 */
export interface SkeletonProps {
  class?: string;
  /** Renders as a circle, for avatars. */
  circle?: boolean;
}

export function Skeleton(props: SkeletonProps) {
  const [local] = splitProps(props, ['class', 'circle']);

  return (
    <div
      aria-hidden="true"
      class={cn(
        'bg-ink-700 motion-safe:animate-pulse',
        local.circle === true ? 'rounded-full' : 'rounded-md',
        local.class,
      )}
    />
  );
}

/** Poster-shaped skeleton for catalogue grids. */
export function SkeletonCard() {
  return (
    <div class="flex flex-col gap-2">
      <Skeleton class="aspect-poster w-full" />
      <Skeleton class="h-4 w-4/5" />
      <Skeleton class="h-3 w-2/5" />
    </div>
  );
}
