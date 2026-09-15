import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX,
  type Setter,
} from 'solid-js';

export interface SearchController {
  open: Accessor<boolean>;
  query: Accessor<string>;
  setQuery: Setter<string>;
  openSearch: (initialQuery?: string) => void;
  closeSearch: () => void;
}

const SearchContext = createContext<SearchController>();

export function SearchProvider(props: { children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');

  const controller: SearchController = {
    open,
    query,
    setQuery,
    openSearch: (initialQuery) => {
      if (initialQuery !== undefined) setQuery(initialQuery);
      setOpen(true);
    },
    closeSearch: () => setOpen(false),
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      setOpen((current) => !current);
    };

    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  return <SearchContext.Provider value={controller}>{props.children}</SearchContext.Provider>;
}

export function useSearch(): SearchController {
  const controller = useContext(SearchContext);

  if (controller === undefined) {
    throw new Error('useSearch must be used inside SearchProvider.');
  }

  return controller;
}
