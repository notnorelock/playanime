import { env } from '@playanime/config';
import { AppError, ErrorCode, ServiceUnavailableError } from '@playanime/shared';

/**
 * Cloudflare Turnstile verification.
 *
 * Talks to Cloudflare's siteverify endpoint directly rather than through a
 * client library — like `oauth/discord.ts`, it's one HTTP call, and a
 * dependency buys little over that.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  readonly success: boolean;
  readonly 'error-codes'?: readonly string[];
}

/**
 * Verifies a Turnstile widget token against Cloudflare.
 *
 * Fails closed: a missing secret key never reaches this function (the
 * config schema requires `TURNSTILE_SECRET_KEY`, so the API refuses to boot
 * without it), and a siteverify call that cannot be reached or returns a
 * non-2xx is treated the same as a failed verification — a Cloudflare
 * outage must not become an open door for the exact abuse this exists to
 * block.
 */
export async function verifyTurnstile(token: string, remoteIp: string): Promise<void> {
  const { TURNSTILE_SECRET_KEY } = env();

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: TURNSTILE_SECRET_KEY, response: token, remoteip: remoteIp }),
    });
  } catch (cause: unknown) {
    throw new ServiceUnavailableError('Weryfikacja Turnstile jest obecnie niedostępna.', { cause });
  }

  if (!response.ok) {
    throw new ServiceUnavailableError('Weryfikacja Turnstile jest obecnie niedostępna.');
  }

  const body = (await response.json()) as SiteverifyResponse;

  if (!body.success) {
    throw new AppError('Weryfikacja Turnstile nie powiodła się. Spróbuj ponownie.', {
      status: 422,
      code: ErrorCode.TURNSTILE_FAILED,
      expose: true,
      details: { errorCodes: body['error-codes'] ?? [] },
    });
  }
}
