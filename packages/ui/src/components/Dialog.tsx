import { Dialog as KobalteDialog } from '@kobalte/core/dialog';
import { X } from 'lucide-solid';
import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Modal dialog.
 *
 * Kobalte handles focus trapping, restoring focus to the trigger on close,
 * `aria-modal`, scroll locking, and Escape. Each is individually easy to get
 * wrong and collectively the difference between a usable dialog and one that
 * strands a keyboard user behind an invisible overlay.
 *
 * `Drawer` below shares this implementation with different positioning — the
 * behaviour is identical, only the transform differs, so duplicating the
 * primitive would mean fixing every focus bug twice.
 */

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  /** Announced with the title. Omit only when the title is self-explanatory. */
  description?: string;
  children?: JSX.Element;
  /** Action row, rendered against the bottom edge. */
  footer?: JSX.Element;
  size?: 'sm' | 'md' | 'lg';
  class?: string;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export function Dialog(props: DialogProps) {
  const [local] = splitProps(props, [
    'open',
    'onOpenChange',
    'title',
    'description',
    'children',
    'footer',
    'size',
    'class',
  ]);

  return (
    <KobalteDialog open={local.open} onOpenChange={local.onOpenChange}>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay
          class={cn(
            'fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm',
            'data-[expanded]:animate-in data-[closed]:animate-out',
          )}
        />

        <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <KobalteDialog.Content
            class={cn(
              'relative w-full surface-raised rounded-lg',
              'flex flex-col max-h-[85dvh]',
              SIZES[local.size ?? 'md'],
              local.class,
            )}
          >
            <div class="flex items-start justify-between gap-4 p-5 pb-4">
              <div class="flex flex-col gap-1">
                <KobalteDialog.Title class="text-lg font-semibold text-paper">
                  {local.title}
                </KobalteDialog.Title>
                <Show when={local.description}>
                  {(description) => (
                    <KobalteDialog.Description class="text-sm text-slate-400">
                      {description()}
                    </KobalteDialog.Description>
                  )}
                </Show>
              </div>

              <KobalteDialog.CloseButton
                class={cn(
                  'shrink-0 rounded-md p-1.5 text-slate-400',
                  'transition-colors duration-[120ms]',
                  'hover:bg-ink-700 hover:text-paper',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                )}
              >
                <X class="size-4" aria-hidden="true" />
                <span class="sr-only">Zamknij</span>
              </KobalteDialog.CloseButton>
            </div>

            {/* Only the body scrolls, so the title and actions stay reachable. */}
            <div class="flex-1 overflow-y-auto px-5 pb-5">{local.children}</div>

            <Show when={local.footer}>
              <div class="flex items-center justify-end gap-2 border-t border-ink-600 p-4">
                {local.footer}
              </div>
            </Show>
          </KobalteDialog.Content>
        </div>
      </KobalteDialog.Portal>
    </KobalteDialog>
  );
}

export interface DrawerProps extends Omit<DialogProps, 'size'> {
  side?: 'left' | 'right' | 'bottom';
}

/**
 * Edge-anchored panel.
 *
 * Used for filters and mobile navigation, where a centred dialog would cover
 * the content the panel is filtering.
 */
export function Drawer(props: DrawerProps) {
  const [local] = splitProps(props, [
    'open',
    'onOpenChange',
    'title',
    'description',
    'children',
    'footer',
    'side',
    'class',
  ]);

  const position = () => {
    switch (local.side ?? 'right') {
      case 'left':
        return 'left-0 top-0 h-full w-full max-w-sm border-r';
      case 'bottom':
        return 'bottom-0 left-0 w-full max-h-[85dvh] rounded-t-lg border-t';
      case 'right':
      default:
        return 'right-0 top-0 h-full w-full max-w-sm border-l';
    }
  };

  return (
    <KobalteDialog open={local.open} onOpenChange={local.onOpenChange}>
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay class="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm" />

        <KobalteDialog.Content
          class={cn(
            'fixed z-50 flex flex-col bg-ink-800 border-ink-600',
            position(),
            local.class,
          )}
        >
          <div class="flex items-start justify-between gap-4 p-5 pb-4">
            <div class="flex flex-col gap-1">
              <KobalteDialog.Title class="text-lg font-semibold text-paper">
                {local.title}
              </KobalteDialog.Title>
              <Show when={local.description}>
                {(description) => (
                  <KobalteDialog.Description class="text-sm text-slate-400">
                    {description()}
                  </KobalteDialog.Description>
                )}
              </Show>
            </div>

            <KobalteDialog.CloseButton class="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-ink-700 hover:text-paper">
              <X class="size-4" aria-hidden="true" />
              <span class="sr-only">Zamknij</span>
            </KobalteDialog.CloseButton>
          </div>

          <div class="flex-1 overflow-y-auto px-5 pb-5">{local.children}</div>

          <Show when={local.footer}>
            <div class="flex items-center justify-end gap-2 border-t border-ink-600 p-4">
              {local.footer}
            </div>
          </Show>
        </KobalteDialog.Content>
      </KobalteDialog.Portal>
    </KobalteDialog>
  );
}

export const DialogTrigger = KobalteDialog.Trigger;
export const DialogRoot = KobalteDialog;
