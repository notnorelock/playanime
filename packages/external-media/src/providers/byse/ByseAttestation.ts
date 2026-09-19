import { createCanvas } from 'canvas';

/**
 * Device attestation for Byse's optional anti-automation check.
 *
 * Generates an ECDSA P-256 keypair, signs a server-issued challenge nonce,
 * and reports a canvas-rendering fingerprint alongside it. This exists
 * specifically because Byse's own operator authorized this integration to
 * use it — it is not a generic anti-detection technique to reach for
 * elsewhere in this codebase.
 *
 * The canvas hash identifies *this server's* rendering stack (node-canvas
 * over Cairo/Pango/fontconfig), not a real browser's — it cannot and does
 * not pretend otherwise. It exists only because Byse's attestation payload
 * has a slot for one; omitting it entirely would look more anomalous to
 * Byse's own scoring than reporting an honest, consistent, non-browser value.
 */

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
}

/**
 * The exact 256x128 drawing routine Byse's own client canvas-fingerprints
 * with. Ported field-for-field (fill color, text position/color, stroke
 * rect) since any deviation produces a different hash than what Byse's
 * scoring expects to see from a consistent, repeat-visit fingerprint.
 */
export function computeByseServerCanvasHash(): Promise<string> {
  const canvas = createCanvas(256, 128);
  const ctx = canvas.getContext('2d');

  ctx.textBaseline = 'top';
  ctx.font = '16px "Arial"';

  ctx.fillStyle = '#f60';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#069';
  ctx.fillText('byse-access', 8, 32);

  ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
  ctx.fillText('byse-access', 10, 48);

  ctx.strokeStyle = '#ff5500';
  ctx.strokeRect(20, 16, 200, 96);

  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // A plain copy, not a `.buffer.slice()` view: node-canvas's `ImageData.data.buffer`
  // types as `ArrayBuffer | SharedArrayBuffer`, which `crypto.subtle.digest`'s
  // `BufferSource` parameter does not accept — `Uint8Array.from` always
  // allocates a fresh, plain `ArrayBuffer`-backed array.
  const bytes = Uint8Array.from(rgba);

  return crypto.subtle.digest('SHA-256', bytes).then(base64UrlEncode);
}

export interface ByseDeviceKeypair {
  readonly privateKey: CryptoKey;
  readonly publicKeyJwk: JsonWebKey;
  readonly privateKeyJwk: JsonWebKey;
}

/** Generates a fresh P-256 keypair for signing an attestation challenge. */
export async function generateByseDeviceKeypair(): Promise<ByseDeviceKeypair> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ]);

  return { privateKey: pair.privateKey, publicKeyJwk, privateKeyJwk };
}

/** Re-imports a previously exported private key, to sign again without regenerating identity. */
export function importByseDevicePrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
}

/** Signs a challenge nonce with the device's private key, base64url-encoded for the wire. */
export async function signByseChallenge(privateKey: CryptoKey, nonce: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(nonce),
  );
  return base64UrlEncode(signature);
}
