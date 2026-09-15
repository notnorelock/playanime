import type { JSX } from 'solid-js';
import { AppRouter } from '~/routes/index.js';

/**
 * Application root.
 *
 * Providers that must wrap the router go here — auth session, preferences,
 * realtime connection — so the router itself stays a plain route table.
 */
export function App(): JSX.Element {
  return <AppRouter />;
}
