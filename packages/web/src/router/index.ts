// The plugin generates this module from `src/views`; its types are emitted to
// `src/typed-router.d.ts` after the first dev/build run.
import { routes } from 'vue-router/auto-routes';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { UserRole, hasAtLeastRole } from '@playanime/contracts';
import { useAuthStore } from '@/store/auth';

/**
 * Application router.
 *
 * History mode is `createWebHistory` in every environment. The previous setup
 * used hash history in development only, which meant deep links, refreshes on
 * nested routes and browser navigation behaved differently in development than
 * in production — exactly the cases most likely to break.
 */
export function createAppRouter(): Router {
  const router = createRouter({
    routes,
    history: createWebHistory(),
    scrollBehavior(_to, _from, savedPosition) {
      return savedPosition ?? { top: 0, behavior: 'smooth' };
    },
  });

  router.beforeEach(async (to) => {
    const auth = useAuthStore();

    // The guard cannot decide anything until the session is known. `resolve`
    // shares one in-flight request, so this awaits rather than polls.
    await auth.resolve();

    const requiresAuth = to.matched.some((record) => record.meta.requiresAuth === true);
    const guestOnly = to.matched.some((record) => record.meta.guest === true);

    if (requiresAuth && !auth.isAuthenticated) {
      // The intended destination is preserved so signing in returns the user
      // where they were going rather than dumping them on the home page.
      return { name: '/login', query: { redirect: to.fullPath } };
    }

    if (guestOnly && auth.isAuthenticated) {
      return { name: '/' };
    }

    /*
     * Staff-only routes.
     *
     * This keeps a signed-in user without the rank from loading the view at
     * all, rather than letting it mount and render an "access denied" panel.
     * It is presentation, not security — every admin endpoint is guarded
     * server-side, and that is what actually decides.
     */
    const requiredRole = to.matched
      .map((record) => record.meta.requiresRole)
      .find((role): role is UserRole => role !== undefined);

    if (requiredRole !== undefined) {
      const role = auth.user?.role;

      if (role === undefined || !hasAtLeastRole(role, requiredRole)) {
        return { name: '/' };
      }
    }

    return true;
  });

  return router;
}
