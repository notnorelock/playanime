import { and, eq, isNull, sql } from 'drizzle-orm';
import { AuthenticationError, ConflictError, ErrorCode, now } from '@playanime/shared';
import { db, profiles, twoFactorSecrets, userPreferences, users, type Database } from '@playanime/database';
import type { SessionUser } from '@playanime/contracts';
import { fakeVerifyPassword, hashPassword, verifyPassword } from './password.js';
import { createSession, type CreatedSession } from './session.js';
import { createTwoFactorChallenge, isTrustedDevice } from './twofactor/service.js';

/**
 * Registration and login.
 *
 * The rule running through this file: an unauthenticated caller must not be
 * able to learn whether an email address is registered. That constrains both
 * the error messages and the timing of the failure paths.
 */

export interface RegisterInput {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
  /** App-generated device identifier — see `upsertDeviceForSession`. */
  readonly deviceId?: string | undefined;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
  /** From the trusted-device cookie, if the browser has one. */
  readonly trustedDeviceToken?: string | undefined;
  /** App-generated device identifier — see `upsertDeviceForSession`. */
  readonly deviceId?: string | undefined;
}

export interface AuthResult {
  readonly user: SessionUser;
  readonly session: CreatedSession;
}

export type LoginOutcome =
  | { readonly kind: 'authenticated'; readonly user: SessionUser; readonly session: CreatedSession }
  | { readonly kind: 'two_factor_required'; readonly challengeToken: string };

/**
 * Creates an account.
 *
 * Runs in a transaction: a user without a profile or preferences row is a
 * broken account, and every later query would have to defend against it.
 */
export async function register(input: RegisterInput, database: Database = db()): Promise<AuthResult> {
  const passwordHash = await hashPassword(input.password);
  const email = input.email.trim();
  const username = input.username.trim();

  const created = await database.transaction(async (tx) => {
    // Checked explicitly for a clear error message; the unique indexes remain
    // the actual guarantee against a concurrent duplicate.
    const existing = await tx
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = lower(${email}) or lower(${users.username}) = lower(${username})`,
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    const clash = existing[0];
    if (clash !== undefined) {
      if (clash.email.toLowerCase() === email.toLowerCase()) {
        throw new ConflictError('Ten adres e-mail jest już zarejestrowany.', {
          code: ErrorCode.EMAIL_ALREADY_REGISTERED,
        });
      }
      throw new ConflictError('Ta nazwa użytkownika jest już zajęta.', {
        code: ErrorCode.USERNAME_TAKEN,
      });
    }

    const [user] = await tx
      .insert(users)
      .values({ email, username, passwordHash })
      .returning({
        id: users.id,
        email: users.email,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      });

    if (user === undefined) throw new Error('User insert returned no row.');

    await tx.insert(profiles).values({ userId: user.id });
    await tx.insert(userPreferences).values({ userId: user.id });

    return user;
  });

  const session = await createSession(
    {
      userId: created.id,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      deviceId: input.deviceId,
    },
    database,
  );

  return {
    user: {
      id: created.id,
      email: created.email,
      username: created.username,
      displayName: null,
      avatar: null,
      role: created.role,
      emailVerified: false,
      createdAt: created.createdAt.toISOString(),
    },
    session,
  };
}

/**
 * Authenticates a user.
 *
 * Every failure returns the same message and takes comparable time:
 *
 * - unknown address: a dummy verification burns the same CPU as a real one, so
 *   the response time does not reveal that the lookup missed
 * - wrong password: identical message
 * - OAuth-only account: identical message, since saying "use Google" would
 *   confirm the address exists
 */
export async function login(input: LoginInput, database: Database = db()): Promise<LoginOutcome> {
  const email = input.email.trim();

  const [record] = await database
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      passwordHash: users.passwordHash,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      suspendedAt: users.suspendedAt,
      suspendedUntil: users.suspendedUntil,
      createdAt: users.createdAt,
      displayName: profiles.displayName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)))
    .limit(1);

  const invalid = new AuthenticationError('Nieprawidłowy e-mail lub hasło.', {
    code: ErrorCode.INVALID_CREDENTIALS,
  });

  if (record?.passwordHash == null) {
    // Equalize timing against the real verification path above.
    await fakeVerifyPassword();
    throw invalid;
  }

  if (!(await verifyPassword(input.password, record.passwordHash))) {
    throw invalid;
  }

  // Suspension is reported distinctly: the caller has proven the credentials,
  // so there is nothing further to conceal, and a generic error would be
  // actively unhelpful.
  if (record.suspendedAt !== null) {
    const stillSuspended = record.suspendedUntil === null || record.suspendedUntil > now();
    if (stillSuspended) {
      throw new AuthenticationError('To konto zostało zawieszone.', { code: ErrorCode.FORBIDDEN });
    }
  }

  // A confirmed 2FA secret gates the session unless this exact browser was
  // already trusted — checked after the password, not before: the credential
  // check must always run in full, so its timing never reveals whether 2FA is
  // even enabled on an account.
  const [twoFactor] = await database
    .select({ id: twoFactorSecrets.id })
    .from(twoFactorSecrets)
    .where(and(eq(twoFactorSecrets.userId, record.id), sql`${twoFactorSecrets.enabledAt} is not null`))
    .limit(1);

  if (twoFactor !== undefined && !(await isTrustedDevice(record.id, input.trustedDeviceToken ?? null, database))) {
    const challengeToken = await createTwoFactorChallenge({ userId: record.id });
    return { kind: 'two_factor_required', challengeToken };
  }

  await database.update(users).set({ lastLoginAt: now() }).where(eq(users.id, record.id));

  const session = await createSession(
    {
      userId: record.id,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      deviceId: input.deviceId,
    },
    database,
  );

  return {
    kind: 'authenticated',
    user: {
      id: record.id,
      email: record.email,
      username: record.username,
      displayName: record.displayName,
      avatar: record.avatarUrl,
      role: record.role,
      emailVerified: record.emailVerifiedAt !== null,
      createdAt: record.createdAt.toISOString(),
    },
    session,
  };
}

/**
 * Maps a user record to its public contract.
 *
 * The single place a row becomes a DTO. `passwordHash` is absent by
 * construction rather than by remembering to omit it — this is the boundary the
 * contracts package exists to enforce.
 */
export function toSessionUser(record: {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: SessionUser['role'];
  emailVerifiedAt: Date | null;
  createdAt: Date;
}): SessionUser {
  return {
    id: record.id,
    email: record.email,
    username: record.username,
    displayName: record.displayName,
    avatar: record.avatarUrl,
    role: record.role,
    emailVerified: record.emailVerifiedAt !== null,
    createdAt: record.createdAt.toISOString(),
  };
}
