import { Select as KobalteSelect } from '@kobalte/core/select';
import { Check, ChevronDown } from 'lucide-solid';
import { Show, splitProps } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Select.
 *
 * Kobalte renders a listbox rather than a native `<select>`, which is what
 * allows consistent styling across platforms — but it also reimplements
 * type-ahead, arrow navigation and the active-descendant wiring the native
 * control gives for free. Worth it here because the options carry counts and
 * indicators a native select cannot render.
 */
export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  options: readonly SelectOption<T>[];
  value?: T;
  onChange?: (value: T | null) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  class?: string;
  size?: 'sm' | 'md';
}

export function Select<T extends string = string>(props: SelectProps<T>) {
  const [local] = splitProps(props, [
    'options',
    'value',
    'onChange',
    'placeholder',
    'label',
    'disabled',
    'class',
    'size',
  ]);

  return (
    <KobalteSelect<SelectOption<T>>
      options={[...local.options]}
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      value={local.options.find((option) => option.value === local.value)}
      onChange={(option) => {
        local.onChange?.(option?.value ?? null);
      }}
      disabled={local.disabled}
      placeholder={local.placeholder ?? 'Wybierz…'}
      itemComponent={(itemProps) => (
        <KobalteSelect.Item
          item={itemProps.item}
          class={cn(
            'flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-sm cursor-pointer',
            'text-slate-300 transition-colors duration-[80ms]',
            'ui-highlighted:bg-ink-700 ui-highlighted:text-paper',
            'ui-selected:text-amber-400',
            'ui-disabled:opacity-45 ui-disabled:cursor-not-allowed',
          )}
        >
          <KobalteSelect.ItemLabel>{itemProps.item.rawValue.label}</KobalteSelect.ItemLabel>
          <KobalteSelect.ItemIndicator>
            <Check class="size-4" aria-hidden="true" />
          </KobalteSelect.ItemIndicator>
        </KobalteSelect.Item>
      )}
      class={cn('flex flex-col gap-1.5', local.class)}
    >
      <Show when={local.label}>
        {(label) => (
          <KobalteSelect.Label class="text-xs font-medium text-slate-300">
            {label()}
          </KobalteSelect.Label>
        )}
      </Show>

      <KobalteSelect.Trigger
        class={cn(
          'inline-flex items-center justify-between gap-2 w-full',
          'bg-ink-850 border border-ink-600 rounded-md text-left',
          'transition-colors duration-[120ms]',
          'hover:border-ink-500',
          'focus-visible:outline-none focus-visible:border-amber-400',
          'ui-disabled:opacity-45 ui-disabled:cursor-not-allowed',
          local.size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-10 px-3 text-sm',
        )}
      >
        <KobalteSelect.Value<SelectOption<T>> class="truncate text-paper">
          {(state) => state.selectedOption().label}
        </KobalteSelect.Value>
        <KobalteSelect.Icon>
          <ChevronDown class="size-4 text-slate-400 shrink-0" aria-hidden="true" />
        </KobalteSelect.Icon>
      </KobalteSelect.Trigger>

      <KobalteSelect.Portal>
        <KobalteSelect.Content
          class={cn(
            'z-50 min-w-(--kb-popper-anchor-width) overflow-hidden',
            'surface-raised rounded-md p-1',
          )}
        >
          <KobalteSelect.Listbox class="max-h-64 overflow-y-auto focus-visible:outline-none" />
        </KobalteSelect.Content>
      </KobalteSelect.Portal>
    </KobalteSelect>
  );
}
