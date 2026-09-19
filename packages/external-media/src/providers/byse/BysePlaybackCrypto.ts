import type { ByseEncryptedPlayback } from './ByseTypes.js';

/**
 * Decryption for Byse's own playback envelope.
 *
 * Byse's client splits the AES-GCM key across several base64url parts and
 * only uses two of them per response, picked by the envelope's own
 * `version` field — ported from the client's own selection rule
 * (`version -> [version, 31 - version]`) rather than guessed, since the two
 * halves must match exactly or decryption fails outright (AES-GCM's tag
 * check rejects a wrong key, it does not silently produce garbage).
 */

// Explicit `Uint8Array<ArrayBuffer>` return types: `new Uint8Array(length)`
// always allocates a plain `ArrayBuffer` at runtime (never a
// `SharedArrayBuffer`), but without pinning the generic parameter here
// TypeScript's inferred return type widens to `Uint8Array<ArrayBufferLike>`,
// which `crypto.subtle`'s `BufferSource` parameters do not accept.
function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/**
 * Picks the two key parts a given envelope `version` selects. Falls back to
 * every part when `version` is absent, out of range, or the computed
 * indices don't fit the array — matching the client's own fallback, since a
 * shape Byse hasn't been observed to send yet should still be attempted
 * rather than rejected outright.
 */
export function selectPlaybackKeyParts(playback: ByseEncryptedPlayback): readonly string[] {
  const parts = playback.keyParts;
  const version = Number(String(playback.version ?? '').trim());

  if (Number.isInteger(version) && version >= 1 && version <= 20) {
    const first = version;
    const second = 31 - version;
    if (first <= parts.length && second <= parts.length && first >= 1 && second >= 1) {
      const selected = [parts[first - 1], parts[second - 1]].filter(
        (part): part is string => typeof part === 'string' && part.length > 0,
      );
      if (selected.length > 0) return selected;
    }
  }

  return parts.filter((part) => part.length > 0);
}

/** Decrypts a playback envelope into its plain JSON payload. */
export async function decryptBysePlayback(playback: ByseEncryptedPlayback): Promise<unknown> {
  if (playback.keyParts.length === 0) {
    throw new Error('Byse playback envelope has no key parts.');
  }

  const selected = selectPlaybackKeyParts(playback);
  if (selected.length === 0) {
    throw new Error('Byse playback envelope has no usable key parts.');
  }

  const keyBytes = concatBytes(selected.map(base64UrlDecode));
  const iv = base64UrlDecode(playback.iv);
  const encrypted = base64UrlDecode(playback.payload);

  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);

  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, encrypted);
  return JSON.parse(new TextDecoder().decode(plain)) as unknown;
}
