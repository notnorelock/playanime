import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';

export function createDebouncedValue<T>(source: Accessor<T>, delayMs = 250): Accessor<T> {
  const [value, setValue] = createSignal<T>(source());

  createEffect(() => {
    const next = source();
    const timer = window.setTimeout(() => {
      setValue(() => next);
    }, delayMs);
    onCleanup(() => window.clearTimeout(timer));
  });

  return value;
}
