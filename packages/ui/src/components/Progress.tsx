import { Progress as KobalteProgress } from '@kobalte/core/progress';
import { Show, splitProps } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Determinate progress.
 *
 * Used for episode watch progress and for library completion. Kobalte supplies
 * the `aria-valuenow`/`min`/`max` wiring, so the value is announced rather than
 * only drawn.
 */
export interface ProgressProps {
  value: number;
  max?: number;
  label?: string;
  /** Shows the numeric value beside the label. */
  showValue?: boolean;
  size?: 'sm' | 'md';
  class?: string;
}

export function Progress(props: ProgressProps) {
  const [local] = splitProps(props, ['value', 'max', 'label', 'showValue', 'size', 'class']);

  return (
    <KobalteProgress
      value={local.value}
      minValue={0}
      maxValue={local.max ?? 100}
      class={cn('flex flex-col gap-1.5', local.class)}
    >
      <Show when={local.label !== undefined || local.showValue === true}>
        <div class="flex items-center justify-between gap-2">
          <Show when={local.label}>
            {(label) => (
              <KobalteProgress.Label class="text-xs text-slate-400">{label()}</KobalteProgress.Label>
            )}
          </Show>
          <Show when={local.showValue}>
            <KobalteProgress.ValueLabel class="tabular text-xs text-slate-300" />
          </Show>
        </div>
      </Show>

      <KobalteProgress.Track
        class={cn(
          'w-full overflow-hidden rounded-full bg-ink-600',
          local.size === 'sm' ? 'h-1' : 'h-1.5',
        )}
      >
        <KobalteProgress.Fill
          class={cn(
            'h-full rounded-full bg-amber-400',
            'w-(--kb-progress-fill-width)',
            'transition-[width] duration-[280ms] ease-out',
          )}
        />
      </KobalteProgress.Track>
    </KobalteProgress>
  );
}
