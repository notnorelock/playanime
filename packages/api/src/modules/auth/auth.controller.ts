import { Elysia, t } from 'elysia';
import { LoginBody, RegisterBody } from '@playanime/contracts';
import {
  CSRF_COOKIE_NAME,
  clearedCookieAttributes,
  csrfCookieAttributes,
  generateCsrfToken,
  listUserSessions,
  login,
  register,
  requireAuth,
  revokeAllSessions,
  revokeSession,
  sessionCookieAttributes,
  sessionCookieName,
} from '@playanime/auth';
import { AuthenticationError, days } from '@playanime/shared';
import { env } from '@playanime/config';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';

/**
 * Authentication routes.
 *
 * The session token is delivered only as an HttpOnly cookie and never appears
 * in a response body. A token in JSON would end up in localStorage, where any
 * XSS reads it — the attack HttpOnly exists to prevent.
 */

const config = env();

/** Issues the session and CSRF cookies together. */
function setAuthCookies(
  cookie: Record<string, { set: (options: Record<string, unknown>) => void }>,
  token: string,
): string {
  const csrfToken = generateCsrfToken();
  const maxAge = Math.floor(days(config.SESSION_TTL_DAYS) / 1000);

  cookie[sessionCookieName()]?.set({ value: token, ...sessionCookieAttributes(maxAge) });
  cookie[CSRF_COOKIE_NAME]?.set({ value: csrfToken, ...csrfCookieAttributes(), maxAge });

  return csrfToken;
}

export const authController = new Elysia({ prefix: '/auth' })
  .use(sessionContext)
  .group('', (app) =>
    app.use(rateLimit('register')).post(
      '/register',
      async ({ body, cookie, request, clientIp, set }) => {
        const result = await register({
          email: body.email,
          username: body.username,
          password: body.password,
          userAgent: request.headers.get('user-agent') ?? undefined,
          ipAddress: clientIp,
        });

        setAuthCookies(cookie, result.session.token);
        set.status = 201;

        return { user: result.user };
      },
      {
        body: RegisterBody,
        detail: {
          summary: 'Create an account',
          description: 'Sets an HttpOnly session cookie. The token is never returned in the body.',
          tags: ['auth'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('login')).post(
      '/login',
      async ({ body, cookie, request, clientIp }) => {
        const result = await login({
          email: body.email,
          password: body.password,
          userAgent: request.headers.get('user-agent') ?? undefined,
          ipAddress: clientIp,
        });

        setAuthCookies(cookie, result.session.token);

        return { user: result.user };
      },
      {
        body: LoginBody,
        detail: {
          summary: 'Sign in',
          description:
            'Rate limited to 5 attempts per minute. Failures are indistinguishable between an unknown address and a wrong password.',
          tags: ['auth'],
        },
      },
    ),
  )
  .post(
    '/logout',
    async ({ session, cookie }) => {
      if (session !== null) {
        await revokeSession(session.sessionId, 'user_logout');
      }

      // Cleared unconditionally: a stale or invalid cookie should still be
      // removed from the browser.
      cookie[sessionCookieName()]?.set({ value: '', ...clearedCookieAttributes() });
      cookie[CSRF_COOKIE_NAME]?.set({ value: '', ...csrfCookieAttributes(), maxAge: 0 });

      return { success: true };
    },
    {
      detail: { summary: 'Sign out of the current session', tags: ['auth'] },
    },
  )
  .get(
    '/me',
    ({ session }) => {
      const authenticated = requireAuth(session);

      return {
        user: {
          id: authenticated.user.id,
          email: authenticated.user.email,
          username: authenticated.user.username,
          displayName: authenticated.user.displayName,
          avatar: authenticated.user.avatarUrl,
          role: authenticated.user.role,
          emailVerified: authenticated.user.emailVerified,
          createdAt: authenticated.user.createdAt.toISOString(),
        },
      };
    },
    {
      detail: { summary: 'Current user', tags: ['auth'] },
    },
  )
  .get(
    '/sessions',
    async ({ session }) => {
      const authenticated = requireAuth(session);
      const rows = await listUserSessions(authenticated.user.id);

      return rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        userAgent: row.userAgent,
        ipAddress: row.ipAddress,
        isCurrent: row.id === authenticated.sessionId,
      }));
    },
    {
      detail: {
        summary: 'List active sessions',
        description: 'Shows every signed-in device, so a user can spot and revoke an unknown one.',
        tags: ['auth'],
      },
    },
  )
  .delete(
    '/sessions/:id',
    async ({ session, params }) => {
      const authenticated = requireAuth(session);

      // Scoped to the caller's own sessions: revoking by id alone would let any
      // user terminate anyone else's session.
      const own = await listUserSessions(authenticated.user.id);
      if (!own.some((row) => row.id === params.id)) {
        throw new AuthenticationError('Nie znaleziono tej sesji.');
      }

      await revokeSession(params.id, 'user_revoked');
      return { success: true };
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { summary: 'Revoke one session', tags: ['auth'] },
    },
  )
  .post(
    '/sessions/revoke-all',
    async ({ session }) => {
      const authenticated = requireAuth(session);

      const revoked = await revokeAllSessions(
        authenticated.user.id,
        'user_revoked_all',
        authenticated.sessionId,
      );

      // The current session is deliberately kept, so "sign out everywhere else"
      // does not also sign the user out of the device they are using; the
      // cookie therefore stays untouched.

      return { revoked };
    },
    {
      detail: {
        summary: 'Revoke every other session',
        description: 'Keeps the current device signed in.',
        tags: ['auth'],
      },
    },
  );
