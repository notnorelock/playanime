import { A, useLocation } from '@solidjs/router';
import { For, Show, type JSX } from 'solid-js';
import Search from 'lucide-solid/icons/search';
import Menu from 'lucide-solid/icons/menu';
import { Button, ToastViewport, cn } from '@playanime/ui';

/**
 * Application shell.
 *
 * The header is sticky because the catalogue is long and search is the primary
 * navigation. It is translucent with a backdrop blur rather than opaque, so
 * poster artwork remains visible behind it while scrolling — a solid bar would
 * cut the page in two.
 */

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Odkrywaj' },
  { href: '/katalog', label: 'Katalog' },
  { href: '/sezon', label: 'Sezon' },
  { href: '/kalendarz', label: 'Kalendarz' },
];

export function RootLayout(props: { children?: JSX.Element }) {
  const location = useLocation();

  const isActive = (href: string): boolean =>
    href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);

  return (
    <div class="flex min-h-dvh flex-col">
      {/* First stop for keyboard users, visually hidden until focused. */}
      <a href="#main" class="skip-link">
        Przejdź do treści
      </a>

      <header
        class={cn(
          'sticky top-0 z-40 h-(--spacing-header)',
          'border-b border-ink-600 bg-ink-900/85 backdrop-blur-md',
        )}
      >
        <div class="container-page flex h-full items-center gap-6">
          <A href="/" class="flex shrink-0 items-center gap-2" aria-label="PlayAnime — strona główna">
            {/* The wordmark uses the display face with a tightened first half,
                so "play" reads as a prefix rather than a separate word. */}
            <span class="font-display text-lg font-bold tracking-tighter text-paper">
              play<span class="text-amber-400">ani</span>.me
            </span>
          </A>

          <nav class="hidden items-center gap-1 md:flex" aria-label="Główna nawigacja">
            <For each={NAV_ITEMS}>
              {(item) => (
                <A
                  href={item.href}
                  class={cn(
                    'relative rounded-md px-3 py-2 text-sm font-medium',
                    'transition-colors duration-[120ms]',
                    isActive(item.href) ? 'text-paper' : 'text-slate-400 hover:text-paper',
                  )}
                >
                  {item.label}
                  {/* The active marker is a rule under the label, matching the
                      tab indicator elsewhere so the pattern is learned once. */}
                  <Show when={isActive(item.href)}>
                    <span
                      class="absolute inset-x-3 -bottom-px h-0.5 bg-amber-400"
                      aria-hidden="true"
                    />
                  </Show>
                </A>
              )}
            </For>
          </nav>

          <div class="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Szukaj">
              <Search />
            </Button>

            <Button variant="ghost" size="icon" class="md:hidden" aria-label="Menu">
              <Menu />
            </Button>

            <Button variant="secondary" size="sm" class="hidden sm:inline-flex">
              Zaloguj się
            </Button>
          </div>
        </div>
      </header>

      <main id="main" class="flex-1">
        {props.children}
      </main>

      <footer class="mt-20 border-t border-ink-600 py-10">
        <div class="container-page flex flex-col gap-6">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p class="text-xs text-slate-500">
              PlayAnime to baza danych i platforma społecznościowa. Nie hostujemy plików wideo.
            </p>

            <nav class="flex flex-wrap gap-x-4 gap-y-1" aria-label="Informacje prawne">
              <A href="/legal/regulamin" class="text-xs text-slate-400 hover:text-paper">
                Regulamin
              </A>
              <A href="/legal/prywatnosc" class="text-xs text-slate-400 hover:text-paper">
                Prywatność
              </A>
              <A href="/legal/prawa-autorskie" class="text-xs text-slate-400 hover:text-paper">
                Prawa autorskie
              </A>
              <A href="/zglos" class="text-xs text-slate-400 hover:text-paper">
                Zgłoś treść
              </A>
            </nav>
          </div>
        </div>
      </footer>

      <ToastViewport />
    </div>
  );
}
