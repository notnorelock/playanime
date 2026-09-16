import { env, isProduction } from '@playanime/config';

/**
 * Session cookie policy.
 *
 * Centralized because every attribute here is a security decision, and an
 * inconsistency between the set and clear paths leaves a cookie the user cannot
 * delete.
 */

export interface CookieAttributes {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax' | 'strict' | 'none';
  readonly path: string;
  readonly maxAge?: number;
  readonly domain?: string;
}

/**
 * Attributes for the session cookie.
 *
 * - `httpOnly` always: script must never read the session token. This is why
 *   tokens are not kept in localStorage — an XSS then reads them trivially.
 * - `secure` in production, so the cookie never crosses plaintext HTTP.
 * - `sameSite: lax` — blocks the cookie on cross-site POSTs (the CSRF vector)
 *   while still sending it on top-level navigation, so following a shared link
 *   into PlayAnime keeps the user signed in. `strict` would sign them out on
 *   every inbound link.
 */
export function sessionCookieAttributes(maxAgeSeconds?: number): CookieAttributes {
  const config = env();
  const production = isProduction(config.NODE_ENV);

  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeSeconds === undefined ? {} : { maxAge: maxAgeSeconds }),
  };
}

/** Attributes that expire the cookie immediately. Must mirror the set path. */
export function clearedCookieAttributes(): CookieAttributes {
  return { ...sessionCookieAttributes(), maxAge: 0 };
}

export function sessionCookieName(): string {
  return env().SESSION_COOKIE_NAME;
}

/**
 * The CSRF cookie.
 *
 * Deliberately NOT `httpOnly`: the double-submit pattern requires the frontend
 * to read this value and echo it in a header. That is safe because the token is
 * not a credential — it only proves the request came from a page able to read
 * this origin's cookies, which a cross-site attacker cannot do.
 */
export function csrfCookieAttributes(): Omit<CookieAttributes, 'httpOnly'> & { httpOnly: false } {
  const config = env();

  return {
    httpOnly: false,
    secure: isProduction(config.NODE_ENV),
    sameSite: 'lax',
    path: '/',
  };
}

export const CSRF_COOKIE_NAME = 'playanime_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * The "remember this device" cookie for 2FA.
 *
 * Same attributes as the session cookie — it is exactly as sensitive, since
 * possessing it skips a security check the account owner turned on — just a
 * different name and a much longer lifetime, since its whole purpose is to
 * outlive a single session.
 */
export const TRUSTED_DEVICE_COOKIE_NAME = 'playanime_trusted_device';
