import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import {
  assertCsrfValid,
  assertOriginAllowed,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  requiresCsrfCheck,
  resolveSession,
  sessionCookieName,
  touchSession,
  type AuthenticatedSession,
} from '@playanime/auth';
import { db, users, userPreferences } from '@playanime/database';
import { minutes } from '@playanime/shared';
import { allowedOrigins, resolveClientIp } from './security.js';

/**
 * Session resolution.
 *
 * Attaches the authenticated user to every request, or null. Guards are applied
 * per route rather than here — most of the catalogue is legitimately anonymous,
 * and a blanket requirement would force every public route to opt out.
 */

export interface RequestSession extends AuthenticatedSession {
  readonly preferences: {
    readonly locale: string;
    readonly showMatureContent: boolean;
    readonly preferredAudioLanguage: string | null;
    readonly preferredSubtitleLanguage: string | null;
  };
  /** Active VIP grant right now — `users.vipUntil` is null or in the future. */
  readonly isVip: boolean;
}

/** Throttles the `last_seen_at` write; see `touchSession`. */
const TOUCH_INTERVAL_MS = minutes(5);

export const sessionContext = new Elysia({ name: 'session-context' })
  .derive({ as: 'global' }, async ({ cookie, request, server }) => {
    const token = cookie[sessionCookieName()]?.value;

    if (typeof token !== 'string' || token.length === 0) {
      return {
        session: null as RequestSession | null,
        clientIp: resolveClientIp(request, server?.requestIP(request)?.address),
      };
    }

    const resolved = await resolveSession(token);

    if (resolved === null) {
      return {
        session: null as RequestSession | null,
        clientIp: resolveClientIp(request, server?.requestIP(request)?.address),
      };
    }

    // Preferences drive content gating and source ranking, so they are loaded
    // with the session rather than fetched again per route.
    const [preferences] = await db()
      .select({
        locale: userPreferences.locale,
        showMatureContent: userPreferences.showMatureContent,
        preferredAudioLanguage: userPreferences.preferredAudioLanguage,
        preferredSubtitleLanguage: userPreferences.preferredSubtitleLanguage,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, resolved.user.id))
      .limit(1);

    // Same fast-path read as the suspension check: `users.vipUntil` mirrors
    // the active `profile_roles` grant, so this never needs a join.
    const [vipRow] = await db()
      .select({ vipUntil: users.vipUntil })
      .from(users)
      .where(eq(users.id, resolved.user.id))
      .limit(1);
    const isVip = vipRow?.vipUntil !== null && vipRow?.vipUntil !== undefined && vipRow.vipUntil > new Date();

    // Write activity at most every few minutes: doing it per request would make
    // this the hottest statement in the system for no operational gain.
    const staleness = Date.now() - resolved.lastSeenAt.getTime();
    if (staleness >= TOUCH_INTERVAL_MS) {
      void touchSession(resolved.sessionId);
    }

    const session: RequestSession = {
      ...resolved,
      preferences: {
        locale: preferences?.locale ?? 'pl',
        showMatureContent: preferences?.showMatureContent ?? false,
        preferredAudioLanguage: preferences?.preferredAudioLanguage ?? null,
        preferredSubtitleLanguage: preferences?.preferredSubtitleLanguage ?? null,
      },
      isVip,
    };

    return {
      session,
      clientIp: resolveClientIp(request, server?.requestIP(request)?.address),
    };
  })
  /**
   * CSRF enforcement.
   *
   * Applied to every mutating request that carries a session cookie. Both
   * checks run: the double-submit token, and an independent origin check that a
   * cross-site attacker cannot satisfy even with a stolen token.
   *
   * Requests without a session cookie are exempt — there is no session to ride,
   * which is what makes CSRF possible in the first place.
   */
  .onBeforeHandle({ as: 'global' }, ({ request, cookie, session }) => {
    if (!requiresCsrfCheck(request.method)) return;
    if (session === null) return;

    assertOriginAllowed(
      request.headers.get('origin') ?? undefined,
      request.headers.get('referer') ?? undefined,
      allowedOrigins,
    );

    const csrfCookie = cookie[CSRF_COOKIE_NAME]?.value;

    assertCsrfValid(
      typeof csrfCookie === 'string' ? csrfCookie : undefined,
      request.headers.get(CSRF_HEADER_NAME) ?? undefined,
    );
  });
