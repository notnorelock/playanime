import { and, eq, isNull, sql } from 'drizzle-orm';
import { cacheGet, cacheSet, redis, redisKeys } from '@playanime/redis';
import { db, profiles, trustedDevices, twoFactorSecrets, users, type Database } from '@playanime/database';
import {
  AppError,
  AuthenticationError,
  ConflictError,
  ErrorCode,
  addMs,
  days,
  newToken,
  now,
} from '@playanime/shared';
import type { SessionUser } from '@playanime/contracts';
import { verifyPassword } from '../password.js';
import { createSession, hashSessionToken, type CreatedSession } from '../session.js';
import { decryptSecret, encryptSecret } from './encryption.js';
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js';

/**
 * TOTP two-factor authentication.
 *
 * Setup is two calls, not one: `startSetup` generates and stores a secret in
 * a disabled state, and only `confirmSetup` — which requires a real code from
 * it — turns it on. A secret nobody has proven they can read (e.g. one lost to
 * a broken QR scan) must never become the thing standing between a user and
 * their own account.
 */

const CHALLENGE_TTL_SECONDS = 5 * 60;
const TRUSTED_DEVICE_DAYS = 30;
const RECOVERY_CODE_COUNT = 10;

/** Random recovery code, formatted for reading back off a screen: `XXXX-XXXX`. */
function generateRecoveryCode(): string {
  const raw = newToken(6).replaceAll(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8).padEnd(8, '0');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function hashRecoveryCode(code: string): string {
  return new Bun.CryptoHasher('sha256').update(code.toUpperCase()).digest('hex');
}

/** Begins enrollment. Returns a fresh secret every call — an unconfirmed one is replaced, not reused. */
export async function startTwoFactorSetup(
  userId: string,
  accountLabel: string,
  database: Database = db(),
): Promise<{ secret: string; otpauthUri: string }> {
  const existing = await database
    .select({ enabledAt: twoFactorSecrets.enabledAt })
    .from(twoFactorSecrets)
    .where(eq(twoFactorSecrets.userId, userId))
    .limit(1);

  if (existing[0]?.enabledAt != null) {
    throw new ConflictError('Weryfikacja dwuetapowa jest już włączona.', {
      code: ErrorCode.TWO_FACTOR_ALREADY_ENABLED,
    });
  }

  const secret = generateTotpSecret();

  await database
    .insert(twoFactorSecrets)
    .values({ userId, encryptedSecret: encryptSecret(secret) })
    .onConflictDoUpdate({
      target: twoFactorSecrets.userId,
      set: { encryptedSecret: encryptSecret(secret), enabledAt: null, recoveryCodeHashes: [] },
    });

  return { secret, otpauthUri: totpUri(secret, accountLabel) };
}

/** Turns on 2FA once the caller proves they can generate a real code from the secret just issued. */
export async function confirmTwoFactorSetup(
  userId: string,
  code: string,
  database: Database = db(),
): Promise<{ recoveryCodes: string[] }> {
  const [row] = await database
    .select({ encryptedSecret: twoFactorSecrets.encryptedSecret, enabledAt: twoFactorSecrets.enabledAt })
    .from(twoFactorSecrets)
    .where(eq(twoFactorSecrets.userId, userId))
    .limit(1);

  if (row === undefined) {
    throw new AppError('Nie rozpoczęto konfiguracji weryfikacji dwuetapowej.', {
      status: 404,
      code: ErrorCode.TWO_FACTOR_SETUP_NOT_FOUND,
      expose: true,
    });
  }
  if (row.enabledAt !== null) {
    throw new ConflictError('Weryfikacja dwuetapowa jest już włączona.', {
      code: ErrorCode.TWO_FACTOR_ALREADY_ENABLED,
    });
  }

  const secret = decryptSecret(row.encryptedSecret);
  if (!verifyTotp(secret, code)) {
    throw new AppError('Nieprawidłowy kod.', {
      status: 422,
      code: ErrorCode.TWO_FACTOR_CODE_INVALID,
      expose: true,
    });
  }

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);

  await database
    .update(twoFactorSecrets)
    .set({ enabledAt: now(), recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) })
    .where(eq(twoFactorSecrets.userId, userId));

  return { recoveryCodes };
}

/** Password-gated: turning 2FA off is exactly the kind of action a stolen, still-open session should not be able to do alone. */
export async function disableTwoFactor(
  userId: string,
  password: string,
  database: Database = db(),
): Promise<void> {
  const [user] = await database
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.passwordHash == null || !(await verifyPassword(password, user.passwordHash))) {
    throw new AuthenticationError('Nieprawidłowe hasło.', { code: ErrorCode.INVALID_CREDENTIALS });
  }

  await database.delete(twoFactorSecrets).where(eq(twoFactorSecrets.userId, userId));
}

export async function getTwoFactorStatus(
  userId: string,
  database: Database = db(),
): Promise<{ enabled: boolean; recoveryCodesRemaining: number }> {
  const [row] = await database
    .select({ enabledAt: twoFactorSecrets.enabledAt, recoveryCodeHashes: twoFactorSecrets.recoveryCodeHashes })
    .from(twoFactorSecrets)
    .where(eq(twoFactorSecrets.userId, userId))
    .limit(1);

  return {
    enabled: row?.enabledAt != null,
    recoveryCodesRemaining: row?.recoveryCodeHashes.length ?? 0,
  };
}

/**
 * Whether this device is already trusted for this user, from the cookie the
 * caller presents (if any). A device that was never marked trusted, or whose
 * token does not match this user, is treated identically to "no cookie" —
 * neither leaks which is the case to the caller.
 */
export async function isTrustedDevice(
  userId: string,
  deviceToken: string | null,
  database: Database = db(),
): Promise<boolean> {
  if (deviceToken === null) return false;

  const tokenHash = hashSessionToken(deviceToken);
  const [row] = await database
    .select({ id: trustedDevices.id })
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.userId, userId),
        eq(trustedDevices.tokenHash, tokenHash),
        sql`${trustedDevices.expiresAt} > now()`,
      ),
    )
    .limit(1);

  return row !== undefined;
}

export interface CreateChallengeInput {
  readonly userId: string;
}

/** Stashes "this user passed the password check" for `verifyTwoFactor` to pick up next. */
export async function createTwoFactorChallenge(input: CreateChallengeInput): Promise<string> {
  const token = newToken(24);
  await cacheSet(redisKeys.twoFactorChallenge(token), input, CHALLENGE_TTL_SECONDS, redis());
  return token;
}

export interface VerifyTwoFactorInput {
  readonly challengeToken: string;
  readonly code: string;
  readonly rememberDevice: boolean;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
  /** App-generated device identifier — see `upsertDeviceForSession`. */
  readonly deviceId?: string | undefined;
}

export interface VerifyTwoFactorResult {
  readonly user: SessionUser;
  readonly session: CreatedSession;
  /** Set as a cookie only when `rememberDevice` was requested and the code was valid. */
  readonly trustedDeviceToken: string | null;
}

/** Completes a login that was interrupted for a 2FA challenge. */
export async function verifyTwoFactor(
  input: VerifyTwoFactorInput,
  database: Database = db(),
): Promise<VerifyTwoFactorResult> {
  const challenge = await cacheGet<CreateChallengeInput>(
    redisKeys.twoFactorChallenge(input.challengeToken),
    redis(),
  );
  if (challenge === null) {
    throw new AppError('Sesja weryfikacji wygasła. Zaloguj się ponownie.', {
      status: 400,
      code: ErrorCode.TWO_FACTOR_CHALLENGE_INVALID,
      expose: true,
    });
  }

  const [record] = await database
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      vipUntil: users.vipUntil,
      createdAt: users.createdAt,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(and(eq(users.id, challenge.userId), isNull(users.deletedAt)))
    .limit(1);

  if (record === undefined) {
    throw new AuthenticationError('Nieprawidłowy kod.', { code: ErrorCode.INVALID_CREDENTIALS });
  }

  const [twoFactor] = await database
    .select({ encryptedSecret: twoFactorSecrets.encryptedSecret, recoveryCodeHashes: twoFactorSecrets.recoveryCodeHashes })
    .from(twoFactorSecrets)
    .where(and(eq(twoFactorSecrets.userId, challenge.userId), sql`${twoFactorSecrets.enabledAt} is not null`))
    .limit(1);

  if (twoFactor === undefined) {
    throw new AppError('Weryfikacja dwuetapowa nie jest włączona na tym koncie.', {
      status: 409,
      code: ErrorCode.TWO_FACTOR_NOT_ENABLED,
      expose: true,
    });
  }

  const normalizedCode = input.code.trim().toUpperCase();
  const isTotpShaped = /^\d{6}$/.test(normalizedCode);

  const valid = isTotpShaped
    ? verifyTotp(decryptSecret(twoFactor.encryptedSecret), normalizedCode)
    : await consumeRecoveryCode(challenge.userId, normalizedCode, twoFactor.recoveryCodeHashes, database);

  if (!valid) {
    throw new AppError('Nieprawidłowy kod.', {
      status: 422,
      code: ErrorCode.TWO_FACTOR_CODE_INVALID,
      expose: true,
    });
  }

  // Single use: a code (recovery or, once matched, this challenge) must not authenticate twice.
  await redis().del(redisKeys.twoFactorChallenge(input.challengeToken));

  await database.update(users).set({ lastLoginAt: now() }).where(eq(users.id, challenge.userId));

  const session = await createSession(
    {
      userId: challenge.userId,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      deviceId: input.deviceId,
    },
    database,
  );

  const trustedDeviceToken = input.rememberDevice
    ? await rememberDevice(challenge.userId, input.userAgent, database)
    : null;

  return {
    user: {
      id: record.id,
      email: record.email,
      username: record.username,
      displayName: record.displayName,
      avatar: record.avatarUrl,
      role: record.role,
      emailVerified: record.emailVerifiedAt !== null,
      isVip: record.vipUntil !== null && record.vipUntil > now(),
      createdAt: record.createdAt.toISOString(),
    },
    session,
    trustedDeviceToken,
  };
}

async function consumeRecoveryCode(
  userId: string,
  code: string,
  currentHashes: readonly string[],
  database: Database,
): Promise<boolean> {
  const hash = hashRecoveryCode(code);
  if (!currentHashes.includes(hash)) return false;

  await database
    .update(twoFactorSecrets)
    .set({ recoveryCodeHashes: currentHashes.filter((entry) => entry !== hash) })
    .where(eq(twoFactorSecrets.userId, userId));

  return true;
}

async function rememberDevice(
  userId: string,
  userAgent: string | undefined,
  database: Database,
): Promise<string> {
  const token = newToken(32);
  await database.insert(trustedDevices).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: addMs(now(), days(TRUSTED_DEVICE_DAYS)),
    userAgent: userAgent?.slice(0, 512) ?? null,
  });
  return token;
}
