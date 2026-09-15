import { A } from '@solidjs/router';
import { Button } from '@playanime/ui';

/**
 * 404.
 *
 * States what happened and offers the two routes back that actually help.
 * An empty screen is an invitation to act, not a dead end.
 */
export function NotFoundPage() {
  return (
    <div class="container-page flex min-h-[60dvh] flex-col items-center justify-center gap-6 text-center">
      <p class="tabular font-display text-6xl font-bold tracking-tighter text-ink-500">404</p>

      <div class="flex flex-col gap-2">
        <h1 class="font-display text-2xl font-semibold text-paper">Nie znaleziono strony</h1>
        <p class="measure text-sm text-slate-400">
          Ten adres nie istnieje albo tytuł został usunięty z katalogu.
        </p>
      </div>

      <div class="flex gap-3">
        <A href="/">
          <Button variant="primary">Strona główna</Button>
        </A>
        <A href="/katalog">
          <Button variant="outline">Przeglądaj katalog</Button>
        </A>
      </div>
    </div>
  );
}
