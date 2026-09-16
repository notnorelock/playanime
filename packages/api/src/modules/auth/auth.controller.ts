import { Elysia, redirect, t } from 'elysia';
import { DiscordCompleteSignupBody, LoginBody, RegisterBody } from '@playanime/contracts';
import {
  CSRF_COOKIE_NAME,
  clearedCookieAttributes,
  completeDiscordCallback,
  completeDiscordSignup,
  csrfCookieAttributes,
  generateCsrfToken,
  listLinkedAccounts,
  listUserSessions,
  login,
  register,
  requireAuth,
  revokeAllSessions,
  revokeSession,
  sessionCookieAttributes,
  sessionCookieName,
  startDiscordAuth,
  unlinkAccount,
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
  )

  /* ---------------------------------------------------------------- */
  /* Discord                                                            */
  /* ---------------------------------------------------------------- */

  .get(
    '/discord',
    async ({ session }) => {
      // Signed in already: this is a "connect Discord" click from settings,
      // not a login attempt.
      const intent = session === null ? 'login' : 'link';
      const url = await startDiscordAuth(intent, session?.user.id);
      return redirect(url);
    },
    {
      detail: {
        summary: 'Start Discord sign-in or account linking',
        description:
          'Redirects to Discord. Linking vs. logging in is decided by whether the caller is already signed in.',
        tags: ['auth'],
      },
    },
  )
  .get(
    '/discord/callback',
    // Redirects via `set.status` + `set.headers.Location` rather than the
    // deprecated `set.redirect` shortcut or the `redirect()` helper (which
    // returns a bare `Response` that bypasses the cookie proxy) — this route
    // also needs to set the session cookie, and `set.cookie` only makes it
    // into the final response alongside `set.headers`/`set.status`.
    async ({ query, cookie, request, clientIp, set }) => {
      const { code, state, error } = query;

      if (error !== undefined || code === undefined || state === undefined) {
        set.status = 302;
        set.headers['Location'] = `${config.WEB_URL}/login?error=discord_cancelled`;
        return;
      }

      const result = await completeDiscordCallback(code, state, {
        userAgent: request.headers.get('user-agent') ?? undefined,
        ipAddress: clientIp,
      });

      set.status = 302;

      if (result.kind === 'signed-in') {
        if (result.session === undefined) throw new Error('Signed-in result missing a session.');
        setAuthCookies(cookie, result.session.token);
        set.headers['Location'] = config.WEB_URL;
        return;
      }

      if (result.kind === 'linked') {
        set.headers['Location'] = `${config.WEB_URL}/settings?linked=discord`;
        return;
      }

      // pending-signup: no account exists yet, so nothing is set here — the
      // frontend collects a username and calls the completion endpoint below.
      const params = new URLSearchParams({
        token: result.pendingSignupToken ?? '',
        username: result.suggestedUsername ?? '',
        ...(result.email === null || result.email === undefined ? {} : { email: result.email }),
      });
      set.headers['Location'] = `${config.WEB_URL}/register/discord?${params.toString()}`;
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        state: t.Optional(t.String()),
        error: t.Optional(t.String()),
      }),
      detail: {
        summary: "Discord's redirect back after authorization",
        tags: ['auth'],
      },
    },
  )
  .group('', (app) =>
    app.use(rateLimit('register')).post(
      '/discord/complete-signup',
      async ({ body, cookie, request, clientIp, set }) => {
        const result = await completeDiscordSignup({
          pendingSignupToken: body.pendingSignupToken,
          username: body.username,
          email: body.email,
          userAgent: request.headers.get('user-agent') ?? undefined,
          ipAddress: clientIp,
        });

        setAuthCookies(cookie, result.session.token);
        set.status = 201;

        return { user: result.user };
      },
      {
        body: DiscordCompleteSignupBody,
        detail: {
          summary: 'Finish a Discord signup with a chosen username',
          description: 'Consumes the pending-signup token from the callback redirect; single use.',
          tags: ['auth'],
        },
      },
    ),
  )
  .get(
    '/linked-accounts',
    ({ session }) => listLinkedAccounts(requireAuth(session).user.id),
    {
      detail: { summary: 'OAuth providers linked to the current account', tags: ['auth'] },
    },
  )
  .delete(
    '/linked-accounts/:provider',
    async ({ session, params }) => {
      await unlinkAccount(requireAuth(session).user.id, params.provider);
      return { success: true };
    },
    {
      params: t.Object({ provider: t.String() }),
      detail: {
        summary: 'Unlink an OAuth provider',
        description: 'Refused when it is the only way to sign in and no password is set.',
        tags: ['auth'],
      },
    },
  );
