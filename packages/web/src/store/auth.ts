import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { SessionUser } from '@playanime/contracts';
import { ApiError, authApi, onUnauthorized } from '@/api';

/**
 * Session state.
 *
 * The session itself lives in an HttpOnly cookie the browser manages, so this
 * store holds no token — only what the API last told us about the current user.
 * `status` is explicit rather than derived from `user !== null`, because
 * "not signed in" and "we have not asked yet" must render differently: the
 * second would otherwise flash a signed-out header on every page load.
 */
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous' | 'expired';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(null);
  const status = ref<AuthStatus>('idle');
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => status.value === 'authenticated' && user.value !== null);
  const isResolved = computed(() => status.value !== 'idle' && status.value !== 'loading');

  /**
   * In-flight resolution.
   *
   * Shared so that concurrent callers — the router guard and a component that
   * mounts at the same moment — await one request rather than each issuing
   * their own `/auth/me`.
   */
  let pending: Promise<void> | null = null;

  /**
   * Establishes the current session against the API.
   *
   * A 401 here is the normal answer for a visitor who is not signed in, not a
   * failure: it resolves the state to `anonymous` and does not surface an
   * error. Anything else leaves the user anonymous but records the reason, so a
   * backend outage is distinguishable from a signed-out visitor.
   */
  async function resolve(force = false): Promise<void> {
    if (!force && isResolved.value) return;
    if (pending !== null) return pending;

    status.value = 'loading';
    error.value = null;

    pending = (async () => {
      try {
        const response = await authApi.me();
        user.value = response.user;
        status.value = 'authenticated';
      } catch (cause: unknown) {
        user.value = null;

        if (ApiError.is(cause) && cause.status === 401) {
          status.value = 'anonymous';
          return;
        }

        status.value = 'anonymous';
        error.value = cause instanceof Error ? cause.message : 'Nie udało się sprawdzić sesji.';
      } finally {
        pending = null;
      }
    })();

    return pending;
  }

  async function login(email: string, password: string): Promise<boolean> {
    status.value = 'loading';
    error.value = null;

    try {
      const response = await authApi.login({ email, password });
      user.value = response.user;
      status.value = 'authenticated';
      return true;
    } catch (cause: unknown) {
      user.value = null;
      status.value = 'anonymous';
      error.value = cause instanceof Error ? cause.message : 'Logowanie nie powiodło się.';
      // Rethrown so the caller can read `fieldErrors` off an ApiError; the
      // message is also stored for views that only render a banner.
      throw cause;
    }
  }

  async function register(email: string, username: string, password: string): Promise<boolean> {
    status.value = 'loading';
    error.value = null;

    try {
      const response = await authApi.register({ email, username, password });
      user.value = response.user;
      status.value = 'authenticated';
      return true;
    } catch (cause: unknown) {
      user.value = null;
      status.value = 'anonymous';
      error.value = cause instanceof Error ? cause.message : 'Rejestracja nie powiodła się.';
      throw cause;
    }
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } catch {
      // The local session is cleared regardless: a failed logout request must
      // not leave the UI claiming the user is still signed in.
    } finally {
      user.value = null;
      status.value = 'anonymous';
      error.value = null;
    }
  }

  /** Called when any request discovers the session is no longer valid. */
  function markExpired(): void {
    if (user.value === null && status.value !== 'authenticated') return;
    user.value = null;
    status.value = 'expired';
  }

  // One subscription for the whole application: any 401 from any call lands
  // here, so state cannot drift from what the server believes.
  onUnauthorized(markExpired);

  return {
    user,
    status,
    error,
    isAuthenticated,
    isResolved,
    resolve,
    login,
    register,
    logout,
    markExpired,
  };
});
