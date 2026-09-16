import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TOTP, RFC 6238, implemented directly rather than through a dependency — the
 * whole algorithm is HMAC-SHA1 over a time counter plus a base32 codec, and
 * every authenticator app (Google Authenticator, Authy, 1Password, ...)
 * speaks this exact spec with these exact defaults.
 */

const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Windows of tolerance either side of "now", to absorb clock drift between the server and the phone. */
const WINDOW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** `index` is always produced by `& 31`, so it is always in range; this just satisfies strict indexing. */
function base32Char(index: number): string {
  const char = BASE32_ALPHABET[index];
  if (char === undefined) throw new Error('Base32 index out of range.');
  return char;
}

/** Random secret, base32-encoded — the form every authenticator app expects to scan or type in. */
export function generateTotpSecret(bytes = 20): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base32Encode(buffer);
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Char((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += base32Char((value << (5 - bits)) & 31);
  }
  return output;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replaceAll(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The `otpauth://` URI an authenticator app scans as a QR code. */
export function totpUri(secret: string, accountLabel: string, issuer = 'PlayAnime'): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', key).update(counterBuffer).digest();
  const offset = (hmac.at(-1) ?? 0) & 0x0f;
  const truncated =
    ((hmac[offset] ?? 0) & 0x7f) << 24 |
    ((hmac[offset + 1] ?? 0) & 0xff) << 16 |
    ((hmac[offset + 2] ?? 0) & 0xff) << 8 |
    ((hmac[offset + 3] ?? 0) & 0xff);

  return String(truncated % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Verifies a 6-digit code against the current time step, and the one step
 * either side of it. Wider windows trade security for tolerance of a phone
 * whose clock has drifted; one step (±30s) is the conventional balance.
 */
export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;

  const counter = Math.floor(at / 1000 / PERIOD_SECONDS);
  const codeBuffer = Buffer.from(code);

  for (let step = -WINDOW_STEPS; step <= WINDOW_STEPS; step += 1) {
    const candidate = Buffer.from(hotp(secret, counter + step));
    if (candidate.length === codeBuffer.length && timingSafeEqual(candidate, codeBuffer)) {
      return true;
    }
  }
  return false;
}
