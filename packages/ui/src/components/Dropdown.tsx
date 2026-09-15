import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { For, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Dropdown menu.
 *
 * For actions, not for choosing a value — that is `Select`. The distinction is
 * more than semantic: a menu announces itself as a list of commands, so a
 * screen-reader user expects each item to *do* something rather than set state.
 */
export interface DropdownItem {
  /** Rendered label. */
  label: string;
  onSelect?: () => void;
  icon?: JSX.Element;
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  hint?: string;
  disabled?: boolean;
  /** Renders in rose. For remove, block, delete. */
  destructive?: boolean;
  /** Draws a divider above this item. */
  separatorBefore?: boolean;
}

export interface DropdownProps {
  trigger: JSX.Element;
  items: readonly DropdownItem[];
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  class?: string;
}

export function Dropdown(props: DropdownProps) {
  const [local] = splitProps(props, ['trigger', 'items', 'placement', 'class']);

  return (
    <DropdownMenu placement={local.placement ?? 'bottom-end'} gutter={4}>
      <DropdownMenu.Trigger
        class={cn(
          'inline-flex items-center rounded-md',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        )}
      >
        {local.trigger}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          class={cn(
            'popover-panel z-50 min-w-48 max-w-[min(22rem,calc(100vw-2rem))]',
            'max-h-[min(24rem,calc(100dvh-2rem))] overflow-y-auto surface-raised rounded-md p-1',
            local.class,
          )}
        >
          <For each={local.items}>
            {(item) => (
              <>
                <Show when={item.separatorBefore}>
                  <DropdownMenu.Separator class="my-1 h-px bg-ink-600" />
                </Show>

                <DropdownMenu.Item
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                  class={cn(
                    'flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm text-sm cursor-pointer',
                    'transition-colors duration-[80ms]',
                    'focus-visible:outline-none',
                    '[&_svg]:size-4 [&_svg]:shrink-0',
                    item.destructive === true
                      ? 'text-rose-400 ui-highlighted:bg-rose-950'
                      : 'text-slate-300 ui-highlighted:bg-ink-700 ui-highlighted:text-paper',
                    'ui-disabled:opacity-45 ui-disabled:cursor-not-allowed',
                  )}
                >
                  <Show when={item.icon}>{item.icon}</Show>
                  <span class="flex-1">{item.label}</span>
                  <Show when={item.hint}>
                    {(hint) => <span class="tabular text-2xs text-slate-500">{hint()}</span>}
                  </Show>
                </DropdownMenu.Item>
              </>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}

export const DropdownRoot = DropdownMenu;
