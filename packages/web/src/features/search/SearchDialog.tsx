import { useNavigate } from '@solidjs/router';
import Search from 'lucide-solid/icons/search';
import { Button, Dialog, Input } from '@playanime/ui';
import { createSignal, type JSX } from 'solid-js';
import { useSearch } from './SearchProvider.js';

/**
 * Global search controller UI. Results remain owned by the catalogue; this
 * component establishes the shared trigger/state and the `search` URL contract.
 */
export function SearchDialog() {
  const search = useSearch();
  const navigate = useNavigate();
  const [error, setError] = createSignal<string>();

  const submit: JSX.EventHandler<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault();
    const query = search.query().trim();

    if (query.length < 2) {
      setError('Wpisz co najmniej 2 znaki.');
      return;
    }

    setError(undefined);
    navigate(`/katalog?search=${encodeURIComponent(query)}`);
    search.closeSearch();
  };

  return (
    <Dialog
      open={search.open()}
      onOpenChange={(open) => {
        if (open) {
          search.openSearch();
        } else {
          search.closeSearch();
          setError(undefined);
        }
      }}
      title="Szukaj anime"
      description="Wyszukaj tytuł polski, angielski lub oryginalny."
      size="sm"
    >
      <form class="flex flex-col gap-4" onSubmit={submit}>
        <Input
          type="search"
          name="search"
          label="Tytuł"
          placeholder="np. Fullmetal Alchemist"
          value={search.query()}
          onChange={search.setQuery}
          error={error()}
          autocomplete="off"
          icon={<Search aria-hidden="true" />}
        />

        <div class="flex items-center justify-between gap-3">
          <span class="hidden text-2xs text-slate-500 sm:inline">
            <kbd>Ctrl</kbd> + <kbd>K</kbd>
          </span>
          <Button type="submit" variant="primary" class="ml-auto">
            Szukaj
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
