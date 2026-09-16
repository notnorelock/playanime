import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { addMs, days, newToken, now, type SessionId, type UserId } from '@playanime/shared';
import { env } from '@playanime/config';
import { db, profiles, sessions, users, type Database } from '@playanime/database';
import type { UserRole } from '@playanime/contracts';
import { upsertDeviceForSession } from './devices.js';

/**
 * Session management.
 *
 * Opaque server-side sessions rather than JWTs. The deciding factor is
 * revocation: a stolen device must stop working the moment the user signs it
 * out, and a suspended account must lose access immediately. A stateless token
 * cannot do either without a revocation list, at which point it is a session
 * with extra steps.
 *
 * The client holds a random token; the database stores only its SHA-256 hash,
 * so a database leak yields no usable sessions.
 */

export interface SessionUserRecord {
  readonly id: UserId;
  readonly email: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly role: UserRole;
  readonly emailVerified: boolean;
  readonly suspendedUntil: Date | null;
  readonly createdAt: Date;
}

export interface AuthenticatedSession {
  readonly sessionId: SessionId;
  readonly user: SessionUserRecord;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
  /** Null when this session has no registered device — see `upsertDeviceForSession`. */
  readonly deviceId: string | null;
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
  /** App-generated device identifier from the login/register request, if any. */
  readonly deviceId?: string | undefined;
}

export interface CreatedSession {
  readonly sessionId: string;
  /** The raw token. Returned once, set as a cookie, and never stored. */
  readonly token: string;
  readonly expiresAt: Date;
  /** True the first time this deviceId has ever been seen for this user — the caller may want to log a `login_new_device` security event. */
  readonly isNewDevice: boolean;
}

/**
 * Hashes a session token.
 *
 * SHA-256 without a work factor is correct here, unlike for passwords: the
 * token is 256 bits of CSPRNG output, so there is no dictionary to attack and
 * a slow hash would only add latency to every authenticated request.
 */
export function hashSessionToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

export async function createSession(
  input: CreateSessionInput,
  database: Database = db(),
): Promise<CreatedSession> {
  const config = env();
  const token = newToken(32);
  const expiresAt = addMs(now(), days(config.SESSION_TTL_DAYS));

  const device = await upsertDeviceForSession(input.userId, input.deviceId, input.userAgent, database);

  const [row] = await database
    .insert(sessions)
    .values({
      userId: input.userId,
      deviceId: device?.id ?? null,
      tokenHash: hashSessionToken(token),
      expiresAt,
      // Truncated: a hostile client can send a very long UA header.
      userAgent: input.userAgent?.slice(0, 512) ?? null,
      ipAddress: input.ipAddress ?? null,
    })
    .returning({ id: sessions.id });

  if (row === undefined) {
    throw new Error('Session insert returned no row.');
  }

  return { sessionId: row.id, token, expiresAt, isNewDevice: device?.isNewDevice ?? false };
}

/**
 * Resolves a session token to its user.
 *
 * Returns null for anything not currently valid — unknown, expired, revoked, or
 * belonging to a suspended or deleted account. Callers treat null uniformly as
 * "not authenticated" and must not distinguish the cases to the client, since
 * that would leak whether a token was ever real.
 */
export async function resolveSession(
  token: string,
  database: Database = db(),
): Promise<AuthenticatedSession | null> {
  if (token.length === 0) return null;

  const tokenHash = hashSessionToken(token);

  const [row] = await database
    .select({
      sessionId: sessions.id,
      deviceId: sessions.deviceId,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      username: users.username,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      suspendedUntil: users.suspendedUntil,
      suspendedAt: users.suspendedAt,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now()),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (row === undefined) return null;

  // A suspension that has not yet lapsed blocks access. Checked here rather
  // than only at login, so suspending an account ends live sessions too.
  if (row.suspendedAt !== null) {
    const stillSuspended = row.suspendedUntil === null || row.suspendedUntil > now();
    if (stillSuspended) return null;
  }

  return {
    sessionId: row.sessionId as SessionId,
    deviceId: row.deviceId,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    user: {
      id: row.userId as UserId,
      email: row.email,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      role: row.role,
      emailVerified: row.emailVerifiedAt !== null,
      suspendedUntil: row.suspendedUntil,
      createdAt: row.createdAt,
    },
  };
}

/**
 * Records activity on a session.
 *
 * Throttled by the caller: writing on every request would make this the busiest
 * statement in the system for no benefit.
 */
export async function touchSession(sessionId: string, database: Database = db()): Promise<void> {
  await database.update(sessions).set({ lastSeenAt: now() }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(
  sessionId: string,
  reason: string,
  database: Database = db(),
): Promise<void> {
  await database
    .update(sessions)
    .set({ revokedAt: now(), revokedReason: reason.slice(0, 64) })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/**
 * Revokes every session for a user.
 *
 * Used on password change, on suspension, and by "sign out everywhere".
 * `exceptSessionId` keeps the current device signed in after a password change.
 * Returns the revoked session ids, so a caller with realtime access (see
 * @playanime/realtime — a sibling tier-4 package this one may not import)
 * can notify each one's socket individually.
 */
export async function revokeAllSessions(
  userId: string,
  reason: string,
  exceptSessionId?: string,
  database: Database = db(),
): Promise<readonly string[]> {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (exceptSessionId !== undefined) {
    conditions.push(sql`${sessions.id} <> ${exceptSessionId}`);
  }

  const revoked = await database
    .update(sessions)
    .set({ revokedAt: now(), revokedReason: reason.slice(0, 64) })
    .where(and(...conditions))
    .returning({ id: sessions.id });

  return revoked.map((row) => row.id);
}

/**
 * Revokes every active session tied to a registered device.
 *
 * Used by "block this device" — distinct from `revokeAllSessions`, which is
 * scoped to a user's sessions regardless of device. Returns the ids of the
 * revoked sessions so the caller can also disconnect their live sockets.
 */
export async function revokeSessionsByDeviceId(
  deviceId: string,
  reason: string,
  database: Database = db(),
): Promise<readonly string[]> {
  const revoked = await database
    .update(sessions)
    .set({ revokedAt: now(), revokedReason: reason.slice(0, 64) })
    .where(and(eq(sessions.deviceId, deviceId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  return revoked.map((row) => row.id);
}

/** A user's active sessions, for the device-management screen. */
export async function listUserSessions(
  userId: string,
  database: Database = db(),
): Promise<
  {
    id: string;
    createdAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
    deviceId: string | null;
  }[]
> {
  return database
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      deviceId: sessions.deviceId,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now())))
    .orderBy(sql`${sessions.lastSeenAt} desc`);
}

/** Deletes long-expired rows. Run periodically under a distributed lock. */
export async function pruneExpiredSessions(
  olderThan: Date,
  database: Database = db(),
): Promise<number> {
  const deleted = await database
    .delete(sessions)
    .where(lt(sessions.expiresAt, olderThan))
    .returning({ id: sessions.id });

  return deleted.length;
}
