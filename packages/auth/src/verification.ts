import { and, eq, isNull } from 'drizzle-orm';
import { addMs, isPast, minutes, now } from '@playanime/shared';
import { db, users, verificationTokens, type Database } from '@playanime/database';

/**
 * Email verification.
 *
 * Reuses `verification_tokens`, the generic single-use-token table — this is
 * its first real caller. A 6-digit code, not the 32-byte random token
 * sessions use: it has to be short enough for a person to type, which trades
 * away entropy the expiry (short) and the consume endpoint's own attempt
 * limit (see `packages/redis`'s `verifyEmailAttempt` scope) are what keep
 * safe rather than the code space itself.
 */

const PURPOSE = 'email_verification';
const CODE_LENGTH = 6;
const EXPIRY_MS = minutes(15);

function generateCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const value = (bytes[0] ?? 0) % 10 ** CODE_LENGTH;
  return value.toString().padStart(CODE_LENGTH, '0');
}

function hashCode(code: string): string {
  return new Bun.CryptoHasher('sha256').update(code).digest('hex');
}

export interface IssuedVerification {
  readonly code: string;
  readonly expiresAt: Date;
}

/**
 * Issues a fresh code, invalidating any prior unconsumed one for this user
 * first — only the most recently sent code is ever valid, so an old email
 * (forwarded, or from a stale inbox tab) can't still work after a resend.
 */
export async function issueEmailVerificationToken(
  userId: string,
  database: Database = db(),
): Promise<IssuedVerification> {
  const code = generateCode();
  const expiresAt = addMs(now(), EXPIRY_MS);

  await database.transaction(async (tx) => {
    await tx
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.userId, userId),
          eq(verificationTokens.purpose, PURPOSE),
          isNull(verificationTokens.consumedAt),
        ),
      );

    await tx.insert(verificationTokens).values({
      userId,
      tokenHash: hashCode(code),
      purpose: PURPOSE,
      expiresAt,
    });
  });

  return { code, expiresAt };
}

/**
 * Consumes a submitted code. On success, marks the token consumed and sets
 * `users.emailVerifiedAt` in one transaction — the caller's session reflects
 * it on its next resolve with no cache to invalidate (`emailVerified` is
 * derived live from this column, see `session.ts`).
 */
export async function consumeEmailVerificationToken(
  userId: string,
  code: string,
  database: Database = db(),
): Promise<boolean> {
  const tokenHash = hashCode(code);

  return database.transaction(async (tx) => {
    const [token] = await tx
      .select()
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.userId, userId),
          eq(verificationTokens.purpose, PURPOSE),
          eq(verificationTokens.tokenHash, tokenHash),
        ),
      )
      .limit(1);

    if (token === undefined) return false;
    if (token.consumedAt !== null || isPast(token.expiresAt)) return false;

    await tx
      .update(verificationTokens)
      .set({ consumedAt: now() })
      .where(eq(verificationTokens.id, token.id));

    await tx.update(users).set({ emailVerifiedAt: now() }).where(eq(users.id, userId));

    return true;
  });
}
