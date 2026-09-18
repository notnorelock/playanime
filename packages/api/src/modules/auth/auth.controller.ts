import { Elysia, redirect, t } from 'elysia';
import {
  CursorQuery,
  DeviceBlockBody,
  DeviceRenameBody,
  DiscordCompleteSignupBody,
  LoginBody,
  RegisterBody,
  ResendVerificationResponse,
  TwoFactorConfirmBody,
  TwoFactorDisableBody,
  TwoFactorVerifyBody,
  VerifyEmailBody,
  VerifyEmailResponse,
} from '@playanime/contracts';
import {
  CSRF_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  clearedCookieAttributes,
  completeDiscordCallback,
  completeDiscordSignup,
  confirmTwoFactorSetup,
  consumeEmailVerificationToken,
  csrfCookieAttributes,
  disableTwoFactor,
  generateCsrfToken,
  getTwoFactorStatus,
  issueEmailVerificationToken,
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
  startTwoFactorSetup,
  unlinkAccount,
  verifyTwoFactor,
} from '@playanime/auth';
import { db, DeviceRepository } from '@playanime/database';
import { notifySessionRevoked } from '@playanime/realtime';
import { AuthenticationError, ErrorCode, clampPageSize, days } from '@playanime/shared';
import { env } from '@playanime/config';
import { renderVerificationEmail, sendEmail } from '@playanime/email';
import { sessionContext } from '../../plugins/session.js';
import { rateLimit } from '../../plugins/rate-limit.js';
import { logger } from '../../plugins/error-handler.js';
import { blockDevice, listDevices, listSecurityEvents, renameDevice, unblockDevice } from './devices.service.js';

const securityEventRepository = new DeviceRepository(db());

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

/**
 * Issues a fresh verification code and emails it, fire-and-forget.
 *
 * Never awaited by a caller that needs the result: a send failure (or a
 * missing `RESEND_API_KEY`, see `sendEmail`'s own doc comment) must not fail
 * registration or a resend request — the account/session state has already
 * committed by the time this runs.
 */
async function issueAndSendVerificationEmail(userId: string, email: string): Promise<void> {
  try {
    const { code } = await issueEmailVerificationToken(userId);
    const verifyUrl = `${config.WEB_URL}/verify-email?code=${code}`;
    const { subject, html, text } = renderVerificationEmail({ code, verifyUrl });
    await sendEmail({ to: email, subject, html, text }, logger);
  } catch (cause: unknown) {
    logger.error('Failed to send verification email', cause, { module: 'auth' });
  }
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
          deviceId: body.deviceId,
        });

        setAuthCookies(cookie, result.session.token);
        set.status = 201;

        // Every password-registered account starts unverified (Discord
        // signups that arrive pre-verified are a separate path and never
        // reach this handler) — fire-and-forget, see the function's own doc.
        void issueAndSendVerificationEmail(result.user.id, result.user.email);

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
        const trustedDeviceCookie = cookie[TRUSTED_DEVICE_COOKIE_NAME]?.value;
        const trustedDeviceToken = typeof trustedDeviceCookie === 'string' ? trustedDeviceCookie : undefined;

        const result = await login({
          email: body.email,
          password: body.password,
          userAgent: request.headers.get('user-agent') ?? undefined,
          ipAddress: clientIp,
          trustedDeviceToken,
          deviceId: body.deviceId,
        });

        if (result.kind === 'two_factor_required') {
          // No session cookie yet — the caller has only proven the password,
          // not the second factor, and must not be treated as signed in.
          return { kind: 'two_factor_required' as const, challengeToken: result.challengeToken };
        }

        setAuthCookies(cookie, result.session.token);

        if (result.session.isNewDevice) {
          await securityEventRepository.recordSecurityEvent({
            actorUserId: result.user.id,
            eventType: 'login_new_device',
          });
        }

        return { kind: 'authenticated' as const, user: result.user };
      },
      {
        body: LoginBody,
        detail: {
          summary: 'Sign in',
          description:
            'Rate limited to 5 attempts per minute. Failures are indistinguishable between an unknown address and a wrong password. ' +
            'A `kind: "two_factor_required"` response means the password was correct but a code from `/auth/2fa/verify` is still needed.',
          tags: ['auth'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('verifyEmailAttempt')).post(
      '/verify-email',
      async ({ body, session }) => {
        const authenticated = requireAuth(session);

        const verified = await consumeEmailVerificationToken(authenticated.user.id, body.code);

        if (!verified) {
          throw new AuthenticationError('Nieprawidłowy lub wygasły kod. Poproś o nowy.', {
            code: ErrorCode.VERIFICATION_CODE_INVALID,
          });
        }

        return { verified: true };
      },
      {
        body: VerifyEmailBody,
        response: { 200: VerifyEmailResponse },
        detail: {
          summary: 'Confirm the emailed verification code',
          description: 'Marks the account verified on success. Rate limited to 10 attempts per hour.',
          tags: ['auth'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('resendVerification')).post(
      '/resend-verification',
      ({ session }) => {
        const authenticated = requireAuth(session);

        if (authenticated.user.emailVerified) {
          return { message: 'Twój adres e-mail jest już potwierdzony.' };
        }

        void issueAndSendVerificationEmail(authenticated.user.id, authenticated.user.email);

        return { message: 'Wysłaliśmy nowy kod na Twój adres e-mail.' };
      },
      {
        response: { 200: ResendVerificationResponse },
        detail: {
          summary: 'Resend the verification code',
          description: 'No-ops with a message if already verified. Rate limited to 3 per hour.',
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
  .group('', (app) =>
    app.use(rateLimit('api')).get(
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
          deviceId: row.deviceId,
        }));
      },
      {
        detail: {
          summary: 'List active sessions',
          description: 'Shows every signed-in device, so a user can spot and revoke an unknown one.',
          tags: ['auth'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('deviceAction')).delete(
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
        await notifySessionRevoked(authenticated.user.id, params.id);

        await securityEventRepository.recordSecurityEvent({
          actorUserId: authenticated.user.id,
          eventType: 'session_revoked',
          targetId: params.id,
        });

        return { success: true };
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: { summary: 'Revoke one session', tags: ['auth'] },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('deviceAction')).post(
      '/sessions/revoke-all',
      async ({ session }) => {
        const authenticated = requireAuth(session);

        const revokedSessionIds = await revokeAllSessions(
          authenticated.user.id,
          'user_revoked_all',
          authenticated.sessionId,
        );

        await Promise.all(
          revokedSessionIds.map((sessionId) => notifySessionRevoked(authenticated.user.id, sessionId)),
        );

        await securityEventRepository.recordSecurityEvent({
          actorUserId: authenticated.user.id,
          eventType: 'session_revoked_all',
          metadata: { revoked: revokedSessionIds.length },
        });

        // The current session is deliberately kept, so "sign out everywhere else"
        // does not also sign the user out of the device they are using; the
        // cookie therefore stays untouched.

        return { revoked: revokedSessionIds.length };
      },
      {
        detail: {
          summary: 'Revoke every other session',
          description: 'Keeps the current device signed in.',
          tags: ['auth'],
        },
      },
    ),
  )

  /* ---------------------------------------------------------------- */
  /* Devices                                                            */
  /* ---------------------------------------------------------------- */

  .group('', (app) =>
    app.use(rateLimit('api')).get(
      '/devices',
      ({ session }) => {
        const authenticated = requireAuth(session);
        return listDevices(authenticated.user.id, authenticated.deviceId);
      },
      {
        detail: {
          summary: 'List registered devices',
          description: 'One row per device, with how many of its sessions are currently active.',
          tags: ['auth'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('deviceAction')).patch(
      '/devices/:id',
      ({ session, params, body }) => renameDevice(requireAuth(session).user.id, params.id, body.displayName),
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: DeviceRenameBody,
        detail: { summary: 'Rename a device', tags: ['auth'] },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('deviceAction')).post(
      '/devices/:id/block',
      ({ session, params, body }) => {
        const authenticated = requireAuth(session);
        return blockDevice(authenticated.user.id, params.id, authenticated.deviceId, body.reason ?? null);
      },
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        body: DeviceBlockBody,
        detail: {
          summary: 'Block a device',
          description:
            'Revokes every active session tied to this device immediately. Refused for the device the caller is currently on.',
          tags: ['auth'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('deviceAction')).post(
      '/devices/:id/unblock',
      ({ session, params }) => unblockDevice(requireAuth(session).user.id, params.id),
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: {
          summary: 'Unblock a device',
          description: 'Changes the device status only — previously revoked sessions stay revoked.',
          tags: ['auth'],
        },
      },
    ),
  )
  .group('', (app) =>
    app.use(rateLimit('api')).get(
      '/security-events',
      ({ session, query }) => {
        const authenticated = requireAuth(session);
        return listSecurityEvents(authenticated.user.id, clampPageSize(query.limit), query.cursor);
      },
      {
        query: t.Object({ ...CursorQuery.properties }),
        detail: {
          summary: "List the current user's recent security activity",
          tags: ['auth'],
        },
      },
    ),
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

      const trustedDeviceCookie = cookie[TRUSTED_DEVICE_COOKIE_NAME]?.value;
      const trustedDeviceToken = typeof trustedDeviceCookie === 'string' ? trustedDeviceCookie : undefined;

      const result = await completeDiscordCallback(code, state, {
        userAgent: request.headers.get('user-agent') ?? undefined,
        ipAddress: clientIp,
        trustedDeviceToken,
      });

      set.status = 302;

      if (result.kind === 'signed-in') {
        if (result.session === undefined) throw new Error('Signed-in result missing a session.');
        setAuthCookies(cookie, result.session.token);
        set.headers['Location'] = config.WEB_URL;
        return;
      }

      if (result.kind === 'linked') {
        set.headers['Location'] = `${config.WEB_URL}/profile/me?linked=discord`;
        return;
      }

      if (result.kind === 'two-factor-required') {
        // No session cookie — Discord only proved the Discord identity, not
        // the account's second factor. The frontend's login page already
        // has the 2FA-code form (built for password login's own challenge);
        // this just hands it the same kind of token via a query param
        // instead of a JSON response, since a redirect can't return JSON.
        const params = new URLSearchParams({ discordChallengeToken: result.challengeToken ?? '' });
        set.headers['Location'] = `${config.WEB_URL}/login?${params.toString()}`;
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
  )

  /* ---------------------------------------------------------------- */
  /* Two-factor authentication                                          */
  /* ---------------------------------------------------------------- */

  .get(
    '/2fa/status',
    ({ session }) => getTwoFactorStatus(requireAuth(session).user.id),
    {
      detail: { summary: 'Whether 2FA is enabled, and recovery codes remaining', tags: ['auth'] },
    },
  )
  .post(
    '/2fa/setup',
    ({ session }) => {
      const authenticated = requireAuth(session);
      return startTwoFactorSetup(authenticated.user.id, authenticated.user.email);
    },
    {
      detail: {
        summary: 'Begin 2FA enrollment',
        description:
          'Returns a fresh secret and its otpauth:// URI every call; an unconfirmed one is replaced, not reused. Not yet enabled — call /2fa/confirm with a real code to turn it on.',
        tags: ['auth'],
      },
    },
  )
  .post(
    '/2fa/confirm',
    ({ body, session }) => confirmTwoFactorSetup(requireAuth(session).user.id, body.code),
    {
      body: TwoFactorConfirmBody,
      detail: {
        summary: 'Confirm 2FA enrollment with a code from the authenticator app',
        description: 'Turns 2FA on and returns one-time recovery codes, shown only this once.',
        tags: ['auth'],
      },
    },
  )
  .post(
    '/2fa/disable',
    async ({ body, session }) => {
      await disableTwoFactor(requireAuth(session).user.id, body.password);
      return { success: true };
    },
    {
      body: TwoFactorDisableBody,
      detail: {
        summary: 'Turn off 2FA',
        description: 'Requires the account password, so a hijacked but still-open session cannot disable it alone.',
        tags: ['auth'],
      },
    },
  )
  .group('', (app) =>
    app.use(rateLimit('login')).post(
      '/2fa/verify',
      async ({ body, cookie, request, clientIp }) => {
        const result = await verifyTwoFactor({
          challengeToken: body.challengeToken,
          code: body.code,
          rememberDevice: body.rememberDevice ?? false,
          userAgent: request.headers.get('user-agent') ?? undefined,
          ipAddress: clientIp,
          deviceId: body.deviceId,
        });

        setAuthCookies(cookie, result.session.token);

        if (result.trustedDeviceToken !== null) {
          const maxAge = Math.floor(days(30) / 1000);
          cookie[TRUSTED_DEVICE_COOKIE_NAME]?.set({
            value: result.trustedDeviceToken,
            ...sessionCookieAttributes(maxAge),
          });
        }

        if (result.session.isNewDevice) {
          await securityEventRepository.recordSecurityEvent({
            actorUserId: result.user.id,
            eventType: 'login_new_device',
          });
        }

        return { user: result.user };
      },
      {
        body: TwoFactorVerifyBody,
        detail: {
          summary: 'Complete a login that was interrupted for a 2FA challenge',
          description:
            'Accepts a 6-digit TOTP code or a recovery code. Rate limited the same as /login, since this is the same credential boundary.',
          tags: ['auth'],
        },
      },
    ),
  );
