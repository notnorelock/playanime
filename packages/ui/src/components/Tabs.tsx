import { Tabs as KobalteTabs } from '@kobalte/core/tabs';
import { For, splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Tabs.
 *
 * Kobalte implements the WAI-ARIA tabs pattern: arrow-key navigation between
 * tabs, Home/End, and roving tabindex so the group is a single tab stop rather
 * than one stop per tab.
 *
 * The active indicator is a 2px amber underline that slides — the one place
 * besides the cour ribbon where movement is worth the attention it draws,
 * because it shows *which* tab you moved to.
 */
export interface TabItem {
  value: string;
  label: string;
  /** Count shown beside the label, e.g. episodes or open reports. */
  count?: number;
  content: JSX.Element;
}

export interface TabsProps {
  items: readonly TabItem[];
  value?: string;
  onChange?: (value: string) => void;
  class?: string;
}

export function Tabs(props: TabsProps) {
  const [local] = splitProps(props, ['items', 'value', 'onChange', 'class']);

  return (
    <KobalteTabs
      value={local.value}
      onChange={local.onChange}
      class={cn('flex flex-col gap-4', local.class)}
    >
      <KobalteTabs.List class="relative flex items-center gap-1 border-b border-ink-600">
        <For each={local.items}>
          {(item) => (
            <KobalteTabs.Trigger
              value={item.value}
              class={cn(
                'relative px-3 py-2.5 text-sm font-medium',
                'text-slate-400 transition-colors duration-[120ms]',
                'hover:text-paper',
                'ui-selected:text-paper',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-t-sm',
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span class="ml-1.5 tabular text-xs text-slate-500">{item.count}</span>
              )}
            </KobalteTabs.Trigger>
          )}
        </For>

        {/* Kobalte positions this against the selected trigger. */}
        <KobalteTabs.Indicator class="absolute bottom-0 h-0.5 bg-amber-400 transition-all duration-[180ms] ease-out" />
      </KobalteTabs.List>

      <For each={local.items}>
        {(item) => (
          <KobalteTabs.Content value={item.value} class="focus-visible:outline-none">
            {item.content}
          </KobalteTabs.Content>
        )}
      </For>
    </KobalteTabs>
  );
}
