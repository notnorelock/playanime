import { newToken } from '@playanime/shared';
import { AppError, ErrorCode } from '@playanime/shared';

/**
 * CSRF protection, double-submit cookie pattern.
 *
 * `SameSite=Lax` already blocks the classic cross-site form POST, so this is
 * defence in depth rather than the only barrier. It still earns its place:
 * Lax is not honoured by every client, and it does not protect against an
 * attacker with a foothold on a sibling subdomain, which can write cookies for
 * the parent domain but cannot read them.
 *
 * The token is not a secret tied to identity — it is a value the legitimate
 * frontend can read from its own origin's cookie and echo back in a header.
 */

export class CsrfError extends AppError {
  constructor(message = 'Nieprawidłowy token CSRF.') {
    super(message, { code: ErrorCode.CSRF_TOKEN_INVALID, status: 403, expose: true });
  }
}

/** HTTP methods that mutate state and therefore require a CSRF token. */
const PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requiresCsrfCheck(method: string): boolean {
  return PROTECTED_METHODS.has(method.toUpperCase());
}

export function generateCsrfToken(): string {
  return newToken(32);
}

/**
 * Compares two tokens in constant time.
 *
 * A plain `===` short-circuits on the first differing byte, which in principle
 * leaks the token prefix through timing. The cost of doing it properly is
 * negligible, so there is no reason to accept the weaker comparison.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}

/**
 * Validates the header token against the cookie token.
 *
 * Throws rather than returning a boolean: every caller treats failure as a
 * rejected request, and an ignored return value would be a silent hole.
 */
export function assertCsrfValid(cookieToken: string | undefined, headerToken: string | undefined): void {
  if (cookieToken === undefined || cookieToken.length === 0) {
    throw new CsrfError('Brak tokenu CSRF w ciasteczku.');
  }

  if (headerToken === undefined || headerToken.length === 0) {
    throw new CsrfError('Brak nagłówka tokenu CSRF.');
  }

  if (!timingSafeEqual(cookieToken, headerToken)) {
    throw new CsrfError();
  }
}

/**
 * Verifies the request origin against the allowed set.
 *
 * A second, independent check: even if an attacker somehow controlled the CSRF
 * token, a browser will not let them forge `Origin`.
 *
 * A missing `Origin` on a mutating request is rejected — every browser sends it
 * on CORS and POST requests, so its absence means a non-browser client, which
 * should be using a different auth mechanism than cookies.
 */
export function assertOriginAllowed(
  origin: string | undefined,
  referer: string | undefined,
  allowedOrigins: readonly string[],
): void {
  const candidate = origin ?? extractOrigin(referer);

  if (candidate === undefined) {
    throw new CsrfError('Brak nagłówka Origin w żądaniu modyfikującym dane.');
  }

  if (!allowedOrigins.includes(candidate)) {
    throw new CsrfError('Origin żądania nie jest dozwolony.');
  }
}

function extractOrigin(referer: string | undefined): string | undefined {
  if (referer === undefined) return undefined;

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
