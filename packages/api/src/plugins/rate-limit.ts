import { Elysia } from 'elysia';
import { RateLimitError } from '@playanime/shared';
import { consumeRateLimit, RATE_LIMITS, type RateLimitName } from '@playanime/redis';
import { env } from '@playanime/config';

/**
 * Rate limiting.
 *
 * Applied per route rather than globally, because the appropriate limit differs
 * by two orders of magnitude between browsing the catalogue and attempting a
 * login.
 *
 * The subject is the user id when authenticated, and the *resolved* client IP
 * otherwise — resolved through the trusted-proxy logic, never taken raw from a
 * header a caller controls.
 */

const config = env();

/** Guards one route with a named limit. */
export function rateLimit(name: RateLimitName) {
  return new Elysia({ name: `rate-limit-${name}` }).onBeforeHandle(
    { as: 'scoped' },
    async (context) => {
      if (!config.RATE_LIMIT_ENABLED) return;

      const { session, clientIp } = context as unknown as {
        session: { user: { id: string } } | null;
        clientIp: string;
      };

      // A signed-in user is limited as themselves, so sharing an IP (a campus,
      // a mobile carrier NAT) does not make one user's activity throttle
      // everyone else's.
      const subject = session?.user.id ?? clientIp;
      const result = await consumeRateLimit(RATE_LIMITS[name], subject);

      if (!result.allowed) {
        throw new RateLimitError(
          result.retryAfterSeconds,
          'Zbyt wiele żądań. Spróbuj ponownie za chwilę.',
        );
      }
    },
  );
}
