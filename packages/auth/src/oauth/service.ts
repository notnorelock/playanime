import { and, eq, isNull, sql } from 'drizzle-orm';
import { cacheGet, cacheSet, redis, redisKeys } from '@playanime/redis';
import { db, oauthAccounts, profiles, userPreferences, users, type Database } from '@playanime/database';
import { AppError, ConflictError, ErrorCode, newToken, now } from '@playanime/shared';
import type { SessionUser } from '@playanime/contracts';
import { createSession, type CreatedSession } from '../session.js';
import { discordAuthorizeUrl, exchangeDiscordCode, fetchDiscordProfile } from './discord.js';

/**
 * Discord login and account linking.
 *
 * Three outcomes for a completed Discord authorization, decided in this order:
 *
 * 1. This Discord identity is already linked to an account — sign into it.
 * 2. The caller is signed in and asked to link (not log in) — attach Discord
 *    to the current account.
 * 3. Neither — nobody has claimed this Discord identity yet. Rather than
 *    creating an account outright, a short-lived "pending signup" record is
 *    stashed in Redis and handed back as an opaque token; the frontend shows
 *    a form for the visitor to choose a PlayAnime username, and that choice
 *    is what actually creates the account.
 */

const STATE_TTL_SECONDS = 5 * 60;
const PENDING_SIGNUP_TTL_SECONDS = 10 * 60;

export type OAuthIntent = 'login' | 'link';

interface OAuthState {
  readonly intent: OAuthIntent;
  /** Present only for `link`: whose account to attach Discord to. */
  readonly userId?: string | undefined;
}

/** Starts a Discord OAuth round trip. Returns the URL to redirect the browser to. */
export async function startDiscordAuth(intent: OAuthIntent, userId?: string): Promise<string> {
  const state = newToken(24);
  await cacheSet(redisKeys.discordOAuthState(state), { intent, userId } satisfies OAuthState, STATE_TTL_SECONDS, redis());
  return discordAuthorizeUrl(state);
}

export interface DiscordCallbackResult {
  readonly kind: 'signed-in' | 'linked' | 'pending-signup';
  readonly user?: SessionUser;
  readonly session?: CreatedSession;
  /** Present only for `pending-signup`: hand this to the frontend's completion form. */
  readonly pendingSignupToken?: string;
  readonly suggestedUsername?: string;
  readonly email?: string | null;
}

/** Handles Discord's redirect back to the callback route. */
export async function completeDiscordCallback(
  code: string,
  state: string,
  requestMeta: { userAgent?: string | undefined; ipAddress?: string | undefined },
  database: Database = db(),
): Promise<DiscordCallbackResult> {
  const stored = await cacheGet<OAuthState>(redisKeys.discordOAuthState(state), redis());
  if (stored === null) {
    throw new AppError('Sesja logowania przez Discord wygasła. Spróbuj ponownie.', {
      status: 400,
      code: ErrorCode.OAUTH_STATE_INVALID,
      expose: true,
    });
  }
  // Single use: a replayed callback must not be able to re-trigger this flow.
  await redis().del(redisKeys.discordOAuthState(state));

  const tokens = await exchangeDiscordCode(code);
  const profile = await fetchDiscordProfile(tokens.accessToken);

  const [existingLink] = await database
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, 'discord'), eq(oauthAccounts.providerAccountId, profile.id)))
    .limit(1);

  if (stored.intent === 'link') {
    if (stored.userId === undefined) {
      throw new AppError('Nieprawidłowe żądanie połączenia konta.', {
        status: 400,
        code: ErrorCode.OAUTH_STATE_INVALID,
        expose: true,
      });
    }

    if (existingLink !== undefined && existingLink.userId !== stored.userId) {
      throw new ConflictError('To konto Discord jest już połączone z innym użytkownikiem.', {
        code: ErrorCode.OAUTH_ACCOUNT_ALREADY_LINKED,
      });
    }

    if (existingLink === undefined) {
      await database.insert(oauthAccounts).values({
        userId: stored.userId,
        provider: 'discord',
        providerAccountId: profile.id,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
      });

      // A one-time backfill, not a standing sync: nothing re-checks this once
      // set, so a custom avatar uploaded later is never clobbered by Discord's.
      if (profile.avatarUrl !== null) {
        await database
          .update(profiles)
          .set({ avatarUrl: profile.avatarUrl })
          .where(and(eq(profiles.userId, stored.userId), isNull(profiles.avatarUrl)));
      }
    }

    return { kind: 'linked' };
  }

  // intent === 'login'
  if (existingLink !== undefined) {
    const session = await signInLinkedAccount(existingLink.userId, requestMeta, database);
    return { kind: 'signed-in', user: session.user, session: session.session };
  }

  // No account claims this Discord identity. Stash the profile and let the
  // visitor pick a username rather than importing Discord's directly.
  const pendingSignupToken = newToken(24);
  await cacheSet(
    redisKeys.discordPendingSignup(pendingSignupToken),
    {
      discordId: profile.id,
      email: profile.email,
      emailVerified: profile.emailVerified,
      avatarUrl: profile.avatarUrl,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt.toISOString(),
    },
    PENDING_SIGNUP_TTL_SECONDS,
    redis(),
  );

  return {
    kind: 'pending-signup',
    pendingSignupToken,
    suggestedUsername: profile.username,
    email: profile.email,
  };
}

async function signInLinkedAccount(
  userId: string,
  requestMeta: { userAgent?: string | undefined; ipAddress?: string | undefined },
  database: Database,
): Promise<{ user: SessionUser; session: CreatedSession }> {
  const [record] = await database
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
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
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (record === undefined) {
    throw new AppError('To konto nie istnieje już w systemie.', {
      status: 404,
      code: ErrorCode.USER_NOT_FOUND,
      expose: true,
    });
  }

  if (record.suspendedAt !== null) {
    const stillSuspended = record.suspendedUntil === null || record.suspendedUntil > now();
    if (stillSuspended) {
      throw new AppError('To konto zostało zawieszone.', {
        status: 403,
        code: ErrorCode.FORBIDDEN,
        expose: true,
      });
    }
  }

  await database.update(users).set({ lastLoginAt: now() }).where(eq(users.id, record.id));

  const session = await createSession(
    { userId: record.id, userAgent: requestMeta.userAgent, ipAddress: requestMeta.ipAddress },
    database,
  );

  return {
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

export interface CompleteSignupInput {
  readonly pendingSignupToken: string;
  readonly username: string;
  /** The visitor may edit the email Discord reported, e.g. if they'd rather use another. */
  readonly email: string;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
}

interface PendingDiscordSignup {
  readonly discordId: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly avatarUrl: string | null;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly tokenExpiresAt: string;
}

/** Creates the account a pending Discord signup was waiting on. */
export async function completeDiscordSignup(
  input: CompleteSignupInput,
  database: Database = db(),
): Promise<{ user: SessionUser; session: CreatedSession }> {
  const pending = await cacheGet<PendingDiscordSignup>(redisKeys.discordPendingSignup(input.pendingSignupToken), redis());
  if (pending === null) {
    throw new AppError('Sesja rejestracji przez Discord wygasła. Spróbuj ponownie.', {
      status: 400,
      code: ErrorCode.OAUTH_STATE_INVALID,
      expose: true,
    });
  }

  const email = input.email.trim();
  const username = input.username.trim();

  const created = await database.transaction(async (tx) => {
    const [existing] = await tx
      .select({ email: users.email, username: users.username })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = lower(${email}) or lower(${users.username}) = lower(${username})`,
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    if (existing !== undefined) {
      if (existing.email.toLowerCase() === email.toLowerCase()) {
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
      .values({
        email,
        username,
        passwordHash: null,
        // Discord vouches for the email the same way a verification link would.
        emailVerifiedAt: pending.emailVerified && pending.email === email ? now() : null,
      })
      .returning({
        id: users.id,
        email: users.email,
        username: users.username,
        role: users.role,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
      });

    if (user === undefined) throw new Error('User insert returned no row.');

    await tx.insert(profiles).values({
      userId: user.id,
      avatarUrl: pending.avatarUrl,
    });
    await tx.insert(userPreferences).values({ userId: user.id });

    await tx.insert(oauthAccounts).values({
      userId: user.id,
      provider: 'discord',
      providerAccountId: pending.discordId,
      accessToken: pending.accessToken,
      refreshToken: pending.refreshToken,
      tokenExpiresAt: new Date(pending.tokenExpiresAt),
    });

    return user;
  });

  // Consumed only once the account actually exists: a failed attempt (a taken
  // username, say) must leave the token usable so a corrected retry works,
  // rather than bouncing the visitor to "session expired" on their first typo.
  await redis().del(redisKeys.discordPendingSignup(input.pendingSignupToken));

  const session = await createSession(
    { userId: created.id, userAgent: input.userAgent, ipAddress: input.ipAddress },
    database,
  );

  return {
    user: {
      id: created.id,
      email: created.email,
      username: created.username,
      displayName: null,
      avatar: pending.avatarUrl,
      role: created.role,
      emailVerified: created.emailVerifiedAt !== null,
      createdAt: created.createdAt.toISOString(),
    },
    session,
  };
}

/** Linked providers for a user, shown on the account settings page. */
export async function listLinkedAccounts(
  userId: string,
  database: Database = db(),
): Promise<{ provider: string; linkedAt: string }[]> {
  const rows = await database
    .select({ provider: oauthAccounts.provider, createdAt: oauthAccounts.createdAt })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, userId));

  return rows.map((row) => ({ provider: row.provider, linkedAt: row.createdAt.toISOString() }));
}

/** Unlinks a provider. Refuses to remove the last sign-in method for a passwordless account. */
export async function unlinkAccount(
  userId: string,
  provider: string,
  database: Database = db(),
): Promise<void> {
  const [user] = await database
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user === undefined) {
    throw new AppError('Nie znaleziono konta.', { status: 404, code: ErrorCode.USER_NOT_FOUND, expose: true });
  }

  if (user.passwordHash === null) {
    const linked = await listLinkedAccounts(userId, database);
    if (linked.length <= 1) {
      throw new ConflictError(
        'Nie można odłączyć jedynego sposobu logowania. Ustaw najpierw hasło.',
        { code: ErrorCode.CONFLICT },
      );
    }
  }

  await database
    .delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)));
}
