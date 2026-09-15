import { Switch as KobalteSwitch } from '@kobalte/core/switch';
import { Show, splitProps } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Switch.
 *
 * For a setting that takes effect immediately. A checkbox is correct where the
 * change is staged until a form is submitted — the distinction matters, because
 * a switch that does nothing until you press Save misleads.
 */
export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  class?: string;
}

export function Switch(props: SwitchProps) {
  const [local] = splitProps(props, ['checked', 'onChange', 'label', 'description', 'disabled', 'class']);

  return (
    <KobalteSwitch
      checked={local.checked}
      onChange={local.onChange}
      disabled={local.disabled}
      class={cn('flex items-start justify-between gap-4', local.class)}
    >
      <div class="flex flex-col gap-0.5">
        <KobalteSwitch.Label class="text-sm font-medium text-paper cursor-pointer">
          {local.label}
        </KobalteSwitch.Label>
        <Show when={local.description}>
          {(description) => (
            <KobalteSwitch.Description class="text-xs text-slate-400">
              {description()}
            </KobalteSwitch.Description>
          )}
        </Show>
      </div>

      <KobalteSwitch.Input class="sr-only" />
      <KobalteSwitch.Control
        class={cn(
          'shrink-0 mt-0.5 h-6 w-11 rounded-full p-0.5 cursor-pointer',
          'bg-ink-600 border border-ink-500',
          'transition-colors duration-[120ms] ease-out',
          'ui-checked:bg-amber-400 ui-checked:border-amber-400',
          'ui-disabled:opacity-45 ui-disabled:cursor-not-allowed',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
        )}
      >
        <KobalteSwitch.Thumb
          class={cn(
            'block size-4.5 rounded-full bg-paper shadow-sm',
            'transition-transform duration-[120ms] ease-out',
            'ui-checked:translate-x-5 ui-checked:bg-ink-950',
          )}
        />
      </KobalteSwitch.Control>
    </KobalteSwitch>
  );
}
