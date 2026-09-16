import type { App } from 'vue';
import { createAppRouter } from '@/router';

/**
 * Installs the router.
 *
 * Session resolution is not triggered here: the navigation guard awaits it on
 * the first route, which is the point at which the answer is actually needed.
 */
export async function setupRouter(app: App) {
  const router = createAppRouter();
  app.use(router);
  await router.isReady();
  return router;
}
