import { Checkbox as KobalteCheckbox } from '@kobalte/core/checkbox';
import { Check, Minus } from 'lucide-solid';
import { Show, splitProps } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Checkbox.
 *
 * For a staged change — one that takes effect when a form is submitted. Use
 * `Switch` for a setting that applies immediately. The distinction matters:
 * a switch that does nothing until you press Save misleads.
 */
export interface CheckboxProps {
  checked?: boolean;
  /** Partially selected, for a "select all" covering only some children. */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  class?: string;
}

export function Checkbox(props: CheckboxProps) {
  const [local] = splitProps(props, [
    'checked',
    'indeterminate',
    'onChange',
    'label',
    'description',
    'disabled',
    'class',
  ]);

  return (
    <KobalteCheckbox
      checked={local.checked}
      indeterminate={local.indeterminate}
      onChange={local.onChange}
      disabled={local.disabled}
      class={cn('flex items-start gap-2.5', local.class)}
    >
      <KobalteCheckbox.Input class="sr-only" />
      <KobalteCheckbox.Control
        class={cn(
          'shrink-0 mt-0.5 size-[18px] rounded-sm cursor-pointer',
          'bg-ink-850 border border-ink-500',
          'flex items-center justify-center',
          'transition-colors duration-[120ms]',
          'hover:border-ink-400',
          'ui-checked:bg-amber-400 ui-checked:border-amber-400',
          'ui-indeterminate:bg-amber-400 ui-indeterminate:border-amber-400',
          'ui-disabled:opacity-45 ui-disabled:cursor-not-allowed',
        )}
      >
        <KobalteCheckbox.Indicator>
          <Show when={local.indeterminate} fallback={<Check class="size-3 text-ink-950" />}>
            <Minus class="size-3 text-ink-950" />
          </Show>
        </KobalteCheckbox.Indicator>
      </KobalteCheckbox.Control>

      <Show when={local.label}>
        {(label) => (
          <div class="flex flex-col gap-0.5">
            <KobalteCheckbox.Label class="text-sm text-paper cursor-pointer leading-snug">
              {label()}
            </KobalteCheckbox.Label>
            <Show when={local.description}>
              {(description) => (
                <KobalteCheckbox.Description class="text-xs text-slate-400">
                  {description()}
                </KobalteCheckbox.Description>
              )}
            </Show>
          </div>
        )}
      </Show>
    </KobalteCheckbox>
  );
}
