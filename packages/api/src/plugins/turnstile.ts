import { Elysia } from 'elysia';
import { verifyTurnstile } from '@playanime/auth';

/**
 * Cloudflare Turnstile verification.
 *
 * Applied per route, the same way `rateLimit` is — an anonymous-abuse
 * boundary, not something every route needs. Reads `body.turnstileToken`,
 * which every contract this guards adds specifically for this purpose (see
 * `RegisterBody`/`ContactMessageRequest`), and the resolved client IP,
 * consistent with how `rateLimit` picks its subject.
 */
export function verifyTurnstileToken() {
  return new Elysia({ name: 'verify-turnstile' }).onBeforeHandle({ as: 'scoped' }, async (context) => {
    const { body, clientIp } = context as unknown as {
      body: { turnstileToken: string };
      clientIp: string;
    };

    await verifyTurnstile(body.turnstileToken, clientIp);
  });
}
