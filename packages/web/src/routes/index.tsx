import { Route, Router } from '@solidjs/router';
import { lazy } from 'solid-js';
import { RootLayout } from '~/layouts/RootLayout.js';

/**
 * Route table.
 *
 * Paths are Polish, matching the audience — a Polish user sharing
 * `/katalog?sort=ocena` reads as a native URL where `/catalogue` would not.
 *
 * Pages below the fold of the initial experience are lazy: the home page ships
 * in the entry chunk, everything else loads on navigation.
 */
const HomePage = lazy(async () => {
  const module = await import('~/pages/HomePage.js');
  return { default: module.HomePage };
});

const CataloguePage = lazy(async () => {
  const module = await import('~/pages/CataloguePage.js');
  return { default: module.CataloguePage };
});

const AnimeDetailPage = lazy(async () => {
  const module = await import('~/pages/AnimeDetailPage.js');
  return { default: module.AnimeDetailPage };
});

const NotFoundPage = lazy(async () => {
  const module = await import('~/pages/NotFoundPage.js');
  return { default: module.NotFoundPage };
});

export function AppRouter() {
  return (
    <Router root={RootLayout}>
      <Route path="/" component={HomePage} />
      <Route path="/katalog" component={CataloguePage} />
      <Route path="/anime/:slug" component={AnimeDetailPage} />
      <Route path="*" component={NotFoundPage} />
    </Router>
  );
}
