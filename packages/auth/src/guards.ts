import { AuthenticationError, AuthorizationError, ErrorCode } from '@playanime/shared';
import { hasAtLeastRole, UserRole } from '@playanime/contracts';
import type { AuthenticatedSession, SessionUserRecord } from './session.js';

/**
 * Authorization guards.
 *
 * Server-side and mandatory. The frontend hides admin controls from ordinary
 * users, but that is presentation — it is these functions that actually decide,
 * and every privileged route calls one.
 *
 * They throw rather than return booleans, so forgetting to check a result
 * cannot silently grant access.
 */

/** Requires an authenticated session. */
export function requireAuth(session: AuthenticatedSession | null): AuthenticatedSession {
  if (session === null) {
    throw new AuthenticationError('Musisz być zalogowany, aby wykonać tę akcję.');
  }
  return session;
}

/**
 * Requires a verified email address.
 *
 * Applied to actions that carry weight — submitting a source, posting a
 * comment — so a throwaway unverified account cannot generate moderation load.
 */
export function requireVerifiedEmail(session: AuthenticatedSession | null): AuthenticatedSession {
  const authenticated = requireAuth(session);

  if (!authenticated.user.emailVerified) {
    throw new AuthenticationError('Potwierdź swój adres e-mail, aby wykonać tę akcję.', {
      code: ErrorCode.EMAIL_NOT_VERIFIED,
    });
  }

  return authenticated;
}

/** Requires at least the given role. Roles are ranked, so admin passes a moderator check. */
export function requireRole(
  session: AuthenticatedSession | null,
  required: UserRole,
): AuthenticatedSession {
  const authenticated = requireAuth(session);

  if (!hasAtLeastRole(authenticated.user.role, required)) {
    throw new AuthorizationError('Nie masz uprawnień do wykonania tej akcji.', {
      code: ErrorCode.INSUFFICIENT_ROLE,
    });
  }

  return authenticated;
}

export const requireModerator = (session: AuthenticatedSession | null): AuthenticatedSession =>
  requireRole(session, UserRole.MODERATOR);

export const requireAdmin = (session: AuthenticatedSession | null): AuthenticatedSession =>
  requireRole(session, UserRole.ADMIN);

/**
 * Requires ownership of a resource, or moderator rank.
 *
 * The common shape for "edit your own comment, or be a moderator". Deliberately
 * does not distinguish "not found" from "not yours" — that difference tells an
 * attacker which ids exist.
 */
export function requireOwnerOrModerator(
  session: AuthenticatedSession | null,
  ownerId: string | null,
): AuthenticatedSession {
  const authenticated = requireAuth(session);

  if (ownerId !== null && authenticated.user.id === ownerId) return authenticated;
  if (hasAtLeastRole(authenticated.user.role, UserRole.MODERATOR)) return authenticated;

  throw new AuthorizationError('Nie masz uprawnień do tego zasobu.');
}

/** Non-throwing rank check, for shaping a response rather than blocking it. */
export function isModerator(user: SessionUserRecord | null): boolean {
  return user !== null && hasAtLeastRole(user.role, UserRole.MODERATOR);
}

export function isAdmin(user: SessionUserRecord | null): boolean {
  return user !== null && hasAtLeastRole(user.role, UserRole.ADMIN);
}
