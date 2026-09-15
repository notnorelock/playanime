import { ValidationError } from '@playanime/shared';

/**
 * Password hashing.
 *
 * Argon2id via Bun's built-in `Bun.password`, which is the OWASP-recommended
 * algorithm: memory-hard, so GPU and ASIC attacks gain far less than they do
 * against bcrypt.
 *
 * Parameters follow OWASP's 2024 guidance (19 MiB, 2 iterations). They are
 * stated explicitly rather than left to defaults, because the cost is a
 * security property that should change deliberately and be visible in review.
 */

const ARGON2_CONFIG = {
  algorithm: 'argon2id',
  memoryCost: 19_456,
  timeCost: 2,
} as const;

/** OWASP recommends length over composition rules; 12 is the practical floor. */
export const MIN_PASSWORD_LENGTH = 12;
/** Bounded so a huge input cannot be used as a CPU-exhaustion vector. */
export const MAX_PASSWORD_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  return Bun.password.hash(password, ARGON2_CONFIG);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row must
 * fail the login, not crash the endpoint.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

/**
 * Burns roughly the cost of a real verification.
 *
 * Called when no user exists for the submitted email. Without it, a failed
 * lookup returns in microseconds while a real verification takes ~50ms, and
 * that difference tells an attacker which addresses are registered.
 */
export async function fakeVerifyPassword(): Promise<false> {
  // A fixed valid hash of a throwaway value; the comparison result is discarded.
  const DUMMY_HASH =
    '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Zm9vYmFyYmF6cXV4Y29ycmVjdGhvcnNlYmF0dGVyeQ';

  try {
    await Bun.password.verify('timing-equalizer', DUMMY_HASH);
  } catch {
    // Expected: the dummy hash need not be valid, only expensive to reject.
  }

  return false;
}

/** Whether a stored hash should be re-hashed with current parameters. */
export function needsRehash(hash: string): boolean {
  // Any non-argon2id hash, or one with weaker parameters than we now require.
  if (!hash.startsWith('$argon2id$')) return true;

  const memoryMatch = /\$m=(\d+)/.exec(hash);
  const timeMatch = /,t=(\d+)/.exec(hash);

  const memory = memoryMatch?.[1] === undefined ? 0 : Number.parseInt(memoryMatch[1], 10);
  const time = timeMatch?.[1] === undefined ? 0 : Number.parseInt(timeMatch[1], 10);

  return memory < ARGON2_CONFIG.memoryCost || time < ARGON2_CONFIG.timeCost;
}

/**
 * Passwords seen so often in breach corpora that they are guessed immediately.
 *
 * A short local list, not a substitute for a proper breach-corpus check — that
 * belongs behind an API call (e.g. HIBP k-anonymity) when the product warrants
 * it. This catches the worst offenders at zero cost.
 */
const OBVIOUS_PASSWORDS = new Set([
  'password1234',
  'qwerty123456',
  '123456789012',
  'passwordpassword',
  'administrator',
  'zaq12wsxcde3',
  'qwertyuiop12',
]);

export function assertPasswordAcceptable(password: string): void {
  const issues: { path: string; message: string }[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push({
      path: 'password',
      message: `Hasło musi mieć co najmniej ${String(MIN_PASSWORD_LENGTH)} znaków.`,
    });
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    issues.push({
      path: 'password',
      message: `Hasło może mieć najwyżej ${String(MAX_PASSWORD_LENGTH)} znaków.`,
    });
  }

  if (OBVIOUS_PASSWORDS.has(password.toLowerCase())) {
    issues.push({ path: 'password', message: 'To hasło jest zbyt popularne.' });
  }

  if (issues.length > 0) {
    throw new ValidationError('Hasło nie spełnia wymagań.', issues);
  }
}
