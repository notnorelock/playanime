import { splitProps } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Indeterminate progress.
 *
 * Always paired with a label for assistive technology — a spinning graphic with
 * no accessible name announces nothing, leaving a screen-reader user unsure
 * whether the interface is working or broken.
 */
export interface SpinnerProps {
  class?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Announced while loading. Defaults to Polish, matching the product. */
  label?: string;
}

const SIZES = { sm: 'size-4', md: 'size-6', lg: 'size-8' } as const;

export function Spinner(props: SpinnerProps) {
  const [local] = splitProps(props, ['class', 'size', 'label']);

  return (
    <div role="status" class="inline-flex items-center gap-2">
      <svg
        class={cn('motion-safe:animate-spin text-amber-400', SIZES[local.size ?? 'md'], local.class)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5" opacity="0.2" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
      </svg>
      <span class="sr-only">{local.label ?? 'Ładowanie…'}</span>
    </div>
  );
}
