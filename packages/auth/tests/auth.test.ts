import { describe, expect, it } from 'bun:test';
import { AuthenticationError, AuthorizationError, ValidationError } from '@playanime/shared';
import { UserRole } from '@playanime/contracts';
import { hashPassword, needsRehash, verifyPassword, assertPasswordAcceptable } from '../src/password.js';
import { hashSessionToken } from '../src/session.js';
import {
  assertCsrfValid,
  assertOriginAllowed,
  CsrfError,
  generateCsrfToken,
  requiresCsrfCheck,
  timingSafeEqual,
} from '../src/csrf.js';
import {
  requireAdmin,
  requireAuth,
  requireModerator,
  requireOwnerOrModerator,
  requireVerifiedEmail,
} from '../src/guards.js';
import type { AuthenticatedSession } from '../src/session.js';

function sessionFor(
  overrides: Partial<AuthenticatedSession['user']> = {},
): AuthenticatedSession {
  return {
    sessionId: 'ses_1' as AuthenticatedSession['sessionId'],
    expiresAt: new Date(Date.now() + 86_400_000),
    lastSeenAt: new Date(),
    user: {
      id: 'usr_1' as AuthenticatedSession['user']['id'],
      email: 'a@example.com',
      username: 'tester',
      displayName: null,
      avatarUrl: null,
      role: UserRole.USER,
      emailVerified: true,
      suspendedUntil: null,
      createdAt: new Date(),
      ...overrides,
    },
  };
}

describe('password hashing', () => {
  it('produces an argon2id hash that verifies', async () => {
    const hash = await hashPassword('correct-horse-battery');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('wrong-horse-battery', hash)).toBe(false);
  });

  it('salts, so identical passwords hash differently', async () => {
    const a = await hashPassword('correct-horse-battery');
    const b = await hashPassword('correct-horse-battery');
    expect(a).not.toBe(b);
  });

  it('returns false for a malformed hash rather than throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('rejects a password below the minimum length', () => {
    expect(() => { assertPasswordAcceptable('short'); }).toThrow(ValidationError);
  });

  it('rejects an over-long password', () => {
    expect(() => { assertPasswordAcceptable('a'.repeat(200)); }).toThrow(ValidationError);
  });

  it('rejects a well-known weak password', () => {
    expect(() => { assertPasswordAcceptable('password1234'); }).toThrow(ValidationError);
  });

  it('flags a weaker legacy hash for rehashing', () => {
    expect(needsRehash('$2b$10$abcdefghijklmnopqrstuv')).toBe(true);
    expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$abc$def')).toBe(true);
  });

  it('does not flag a current hash', async () => {
    expect(needsRehash(await hashPassword('correct-horse-battery'))).toBe(false);
  });
});

describe('session tokens', () => {
  it('hashes deterministically to 64 hex characters', () => {
    const hash = hashSessionToken('token-value');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken('token-value')).toBe(hash);
  });

  it('produces different hashes for different tokens', () => {
    expect(hashSessionToken('a')).not.toBe(hashSessionToken('b'));
  });
});

describe('CSRF', () => {
  it('requires a check on mutating methods only', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(requiresCsrfCheck(method)).toBe(true);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(requiresCsrfCheck(method)).toBe(false);
    }
  });

  it('accepts matching cookie and header tokens', () => {
    const token = generateCsrfToken();
    expect(() => {
      assertCsrfValid(token, token);
    }).not.toThrow();
  });

  it('rejects a mismatch', () => {
    expect(() => {
      assertCsrfValid(generateCsrfToken(), generateCsrfToken());
    }).toThrow(CsrfError);
  });

  it('rejects a missing cookie or header', () => {
    const token = generateCsrfToken();
    expect(() => {
      assertCsrfValid(undefined, token);
    }).toThrow(CsrfError);
    expect(() => {
      assertCsrfValid(token, undefined);
    }).toThrow(CsrfError);
  });

  it('compares in constant time without short-circuiting on length', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('accepts an allowed origin', () => {
    expect(() => {
      assertOriginAllowed('https://playani.me', undefined, ['https://playani.me']);
    }).not.toThrow();
  });

  it('rejects a foreign origin', () => {
    expect(() => {
      assertOriginAllowed('https://attacker.example', undefined, ['https://playani.me']);
    }).toThrow(CsrfError);
  });

  it('falls back to the referer origin when Origin is absent', () => {
    expect(() => {
      assertOriginAllowed(undefined, 'https://playani.me/anime/naruto', ['https://playani.me']);
    }).not.toThrow();
  });

  it('rejects a mutating request with neither Origin nor Referer', () => {
    expect(() => {
      assertOriginAllowed(undefined, undefined, ['https://playani.me']);
    }).toThrow(CsrfError);
  });
});

describe('guards', () => {
  it('rejects an anonymous caller', () => {
    expect(() => requireAuth(null)).toThrow(AuthenticationError);
  });

  it('admits an authenticated caller', () => {
    expect(requireAuth(sessionFor()).user.username).toBe('tester');
  });

  it('rejects an unverified email where verification is required', () => {
    expect(() => { requireVerifiedEmail(sessionFor({ emailVerified: false })); }).toThrow(
      AuthenticationError,
    );
  });

  it('rejects an ordinary user from moderator actions', () => {
    expect(() => { requireModerator(sessionFor()); }).toThrow(AuthorizationError);
  });

  it('admits a moderator', () => {
    expect(() => requireModerator(sessionFor({ role: UserRole.MODERATOR }))).not.toThrow();
  });

  it('admits an admin to moderator actions, since roles are ranked', () => {
    expect(() => requireModerator(sessionFor({ role: UserRole.ADMIN }))).not.toThrow();
  });

  it('rejects a moderator from admin-only actions', () => {
    expect(() => { requireAdmin(sessionFor({ role: UserRole.MODERATOR })); }).toThrow(AuthorizationError);
  });

  it('admits the owner of a resource', () => {
    expect(() => requireOwnerOrModerator(sessionFor(), 'usr_1')).not.toThrow();
  });

  it('rejects a non-owner who is not a moderator', () => {
    expect(() => requireOwnerOrModerator(sessionFor(), 'usr_other')).toThrow(AuthorizationError);
  });

  it('admits a moderator acting on another user resource', () => {
    expect(() =>
      requireOwnerOrModerator(sessionFor({ role: UserRole.MODERATOR }), 'usr_other'),
    ).not.toThrow();
  });

  it('rejects an anonymous caller before considering ownership', () => {
    expect(() => requireOwnerOrModerator(null, 'usr_1')).toThrow(AuthenticationError);
  });
});
