import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '@playanime/config';

/**
 * At-rest encryption for the TOTP secret.
 *
 * AES-256-GCM keyed from `SESSION_SECRET` rather than a secret of its own:
 * introducing a second root secret to manage and rotate is a real cost, and
 * `SESSION_SECRET` already carries the platform's highest-sensitivity data
 * (it authenticates every session). Rotating it already invalidates every
 * session by design — losing every stored 2FA secret alongside that on a
 * rotation is the correct failure mode, not an accidental one: a compromise
 * serious enough to rotate the session key should not leave old 2FA secrets
 * silently valid.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function derivedKey(): Buffer {
  // SESSION_SECRET is validated as 32+ arbitrary characters, not 32 bytes of
  // key material — hashing derives an actual AES-256 key from it.
  return createHash('sha256').update(env().SESSION_SECRET).digest();
}

/** `iv:authTag:ciphertext`, each hex-encoded — plain enough to store in one text column. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  if (ivHex === undefined || authTagHex === undefined || ciphertextHex === undefined) {
    throw new Error('Malformed encrypted 2FA secret.');
  }

  const decipher = createDecipheriv(ALGORITHM, derivedKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
