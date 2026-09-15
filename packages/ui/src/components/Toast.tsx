import { Toast as KobalteToast, toaster } from '@kobalte/core/toast';
import AlertTriangle from 'lucide-solid/icons/alert-triangle';
import CheckCircle2 from 'lucide-solid/icons/check-circle-2';
import Info from 'lucide-solid/icons/info';
import X from 'lucide-solid/icons/x';
import XCircle from 'lucide-solid/icons/x-circle';
import { Show, type JSX } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Toast notifications.
 *
 * Kobalte's toaster renders into a live region, so a toast is announced rather
 * than only shown — which matters because a toast is frequently the *only*
 * confirmation that an action succeeded.
 *
 * Errors are not auto-dismissed: a message a user may need to read twice, or
 * act on, must not vanish on a timer.
 */

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

const KIND_STYLES: Readonly<Record<ToastKind, { border: string; icon: JSX.Element }>> = {
  success: { border: 'border-l-jade-400', icon: <CheckCircle2 class="size-4 text-jade-400" /> },
  error: { border: 'border-l-rose-400', icon: <XCircle class="size-4 text-rose-400" /> },
  warning: { border: 'border-l-amber-400', icon: <AlertTriangle class="size-4 text-amber-400" /> },
  info: { border: 'border-l-sky-400', icon: <Info class="size-4 text-sky-400" /> },
};

export interface ShowToastOptions {
  title: string;
  description?: string;
  kind?: ToastKind;
  /** Milliseconds before auto-dismiss. Errors default to staying open. */
  duration?: number;
}

/**
 * Queues a toast.
 *
 * Callable from anywhere — a store, a service, an event handler — so a
 * component does not have to thread a notification callback down to reach it.
 */
export function showToast(options: ShowToastOptions): number {
  const kind = options.kind ?? 'info';
  const style = KIND_STYLES[kind];

  return toaster.show((props) => (
    <KobalteToast
      toastId={props.toastId}
      // An error stays until dismissed; anything else clears itself.
      duration={options.duration ?? (kind === 'error' ? Number.POSITIVE_INFINITY : 5000)}
      class={cn(
        'pointer-events-auto flex items-start gap-3 w-full p-3.5',
        'surface-raised rounded-md border-l-2',
        style.border,
      )}
    >
      <span class="shrink-0 mt-0.5">{style.icon}</span>

      <div class="flex flex-col gap-0.5 flex-1 min-w-0">
        <KobalteToast.Title class="text-sm font-medium text-paper">{options.title}</KobalteToast.Title>
        <Show when={options.description}>
          {(description) => (
            <KobalteToast.Description class="text-xs text-slate-400 break-words">
              {description()}
            </KobalteToast.Description>
          )}
        </Show>
      </div>

      <KobalteToast.CloseButton
        class={cn(
          'shrink-0 rounded-sm p-1 text-slate-400',
          'transition-colors duration-[120ms]',
          'hover:bg-ink-700 hover:text-paper',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
        )}
      >
        <X class="size-3.5" aria-hidden="true" />
        <span class="sr-only">Zamknij powiadomienie</span>
      </KobalteToast.CloseButton>
    </KobalteToast>
  ));
}

/**
 * Toast viewport. Mounted once, near the root of the application.
 *
 * Bottom-right on desktop; full-width at the bottom on mobile, where a corner
 * toast would sit under the thumb.
 */
export function ToastViewport() {
  return (
    <KobalteToast.Region>
      <KobalteToast.List
        class={cn(
          'pointer-events-none fixed z-100 flex flex-col gap-2 outline-none',
          'bottom-0 left-0 right-0 p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]',
          'sm:bottom-4 sm:right-4 sm:left-auto sm:w-96 sm:p-0',
        )}
      />
    </KobalteToast.Region>
  );
}

export { toaster };
