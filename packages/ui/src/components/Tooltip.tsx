import { Tooltip as KobalteTooltip } from '@kobalte/core/tooltip';
import { splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Tooltip.
 *
 * For supplementary detail only. A tooltip is unreachable on touch and
 * inconsistently announced by screen readers, so anything a user *must* read
 * belongs in visible text — this carries the keyboard shortcut, the full title
 * behind a truncation, the exact timestamp behind a relative one.
 */
export interface TooltipProps {
  content: JSX.Element;
  children: JSX.Element;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay before opening. Long enough not to fire on a pointer passing through. */
  openDelay?: number;
}

export function Tooltip(props: TooltipProps) {
  const [local] = splitProps(props, ['content', 'children', 'placement', 'openDelay']);

  return (
    <KobalteTooltip
      placement={local.placement ?? 'top'}
      openDelay={local.openDelay ?? 400}
      closeDelay={100}
      gutter={6}
    >
      <KobalteTooltip.Trigger as="span" class="inline-flex">
        {local.children}
      </KobalteTooltip.Trigger>

      <KobalteTooltip.Portal>
        <KobalteTooltip.Content
          class={cn(
            'z-50 max-w-xs rounded-md px-2.5 py-1.5',
            'bg-ink-700 border border-ink-500 shadow-md',
            'text-xs text-paper',
          )}
        >
          {local.content}
        </KobalteTooltip.Content>
      </KobalteTooltip.Portal>
    </KobalteTooltip>
  );
}
