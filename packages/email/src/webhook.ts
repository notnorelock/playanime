/**
 * Resend webhook signature verification.
 *
 * Resend signs webhook POSTs using Svix's scheme — implemented directly here
 * (no `svix`/`resend` SDK dependency) rather than pulling in a library for
 * one HMAC check, matching this package's existing no-SDK discipline (see
 * `sender.ts`'s own doc comment). The algorithm, per Svix's published spec:
 *
 *   1. secret = base64decode(strip "whsec_" prefix from RESEND_WEBHOOK_SECRET)
 *   2. signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   3. expected = base64encode(HMAC-SHA256(secret, signedContent))
 *   4. compare `expected` against each space-separated, "v1,"-stripped
 *      entry in the svix-signature header (there can be more than one,
 *      e.g. during secret rotation) — constant-time, and accept if ANY
 *      entry matches.
 *
 * Must be called with the RAW request body string — re-serializing parsed
 * JSON can byte-for-byte differ from what was actually signed (key order,
 * whitespace), which silently breaks verification.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@playanime/config';

export interface WebhookHeaders {
  readonly id: string;
  readonly timestamp: string;
  readonly signature: string;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Verifies a Resend webhook request came from Resend and hasn't been
 * tampered with. Returns `false` (never throws) on any failure — a missing
 * `RESEND_WEBHOOK_SECRET`, a malformed header, or a genuine mismatch are all
 * "reject this request," not distinguishable failure modes the caller needs.
 */
export function verifyResendWebhook(rawBody: string, headers: WebhookHeaders): boolean {
  const configured = env().RESEND_WEBHOOK_SECRET;
  if (configured === undefined) return false;

  const secretBase64 = configured.startsWith('whsec_') ? configured.slice('whsec_'.length) : configured;

  let secret: Buffer;
  try {
    secret = Buffer.from(secretBase64, 'base64');
  } catch {
    return false;
  }

  const signedContent = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signedContent).digest('base64');

  const candidates = headers.signature
    .split(' ')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.includes(',') ? entry.slice(entry.indexOf(',') + 1) : entry));

  return candidates.some((candidate) => constantTimeEqual(candidate, expected));
}
