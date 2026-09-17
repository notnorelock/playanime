import { Elysia } from 'elysia';
import { PayloadTooLargeError } from '@playanime/shared';
import { corsOrigins, env, isProduction } from '@playanime/config';

/**
 * Security headers, CORS, and request limits.
 */

const config = env();
const allowedOrigins = corsOrigins(config);

/**
 * Response headers applied to every API response.
 *
 * The API returns JSON, never HTML, so its own CSP can be maximally
 * restrictive: nothing should ever be loaded or executed from an API response.
 * The web application ships its own, broader policy — including the `frame-src`
 * allowlist for embedded providers, which belongs on the document that actually
 * creates the iframes.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // Blocks MIME sniffing, which is how a JSON response becomes executable.
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // The API needs no device capabilities whatsoever.
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-resource-policy': 'same-site',
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

export const security = new Elysia({ name: 'security' })
  .onRequest(({ set, request }) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      set.headers[header] = value;
    }

    // HSTS only over TLS: sent on a plaintext response it is ignored, and in
    // development it would pin localhost to https in the developer's browser.
    if (isProduction(config.NODE_ENV) && new URL(request.url).protocol === 'https:') {
      set.headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
    }
  })
  /**
   * CORS.
   *
   * The origin is echoed only when it is in the allowlist — never reflected
   * blindly, and never `*`, because the API serves credentialed requests where
   * a wildcard is both invalid and dangerous.
   */
  .onRequest(({ set, request }) => {
    const origin = request.headers.get('origin');
    if (origin === null || !allowedOrigins.includes(origin)) return;

    set.headers['access-control-allow-origin'] = origin;
    set.headers['access-control-allow-credentials'] = 'true';
    // Tells caches the response varies by origin; without it a CDN could serve
    // one origin's CORS headers to another.
    set.headers.vary = 'Origin';
  })
  .options('/*', ({ set, request }) => {
    const origin = request.headers.get('origin');

    if (origin !== null && allowedOrigins.includes(origin)) {
      set.headers['access-control-allow-methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
      /*
       * `sentry-trace` and `baggage` are the W3C-style distributed tracing
       * headers a browser SDK attaches to any request matching its configured
       * propagation targets. They are request metadata, not credentials, and
       * omitting them here makes the browser reject the *preflight* — so every
       * API call from an instrumented page fails before it is sent, with a CORS
       * error that points at the header rather than at the tracing config.
       */
      set.headers['access-control-allow-headers'] =
        'content-type,x-csrf-token,x-request-id,sentry-trace,baggage';
      set.headers['access-control-max-age'] = '86400';
    }

    set.status = 204;
    return '';
  })
  /**
   * Request body limit.
   *
   * Enforced on the declared Content-Length before the body is read, so an
   * oversized upload is rejected without buffering it.
   */
  .onRequest(({ request }) => {
    const declared = request.headers.get('content-length');
    if (declared === null) return;

    const size = Number.parseInt(declared, 10);
    if (Number.isFinite(size) && size > config.MAX_REQUEST_BODY_BYTES) {
      throw new PayloadTooLargeError(
        `Żądanie przekracza limit ${String(config.MAX_REQUEST_BODY_BYTES)} bajtów.`,
      );
    }
  });

/**
 * Resolves the client IP.
 *
 * `CF-Connecting-IP` is checked first: the production deploy sits behind
 * Cloudflare, and the peer address Caddy/webserver actually see on every
 * request is Cloudflare's own edge, not the visitor — `X-Forwarded-For`'s
 * hop-counting below would need to reach past that edge hop too, which is
 * fragile (Cloudflare's own forwarding behavior for that header isn't a
 * documented contract the way `CF-Connecting-IP` is). This header is only
 * safe to trust unconditionally because the VPS firewall (see
 * `infrastructure/docker/install-vps.sh`) restricts inbound 80/443 to
 * Cloudflare's published IP ranges — nothing that isn't Cloudflare can
 * reach this API at all, so nothing else could have set this header. A
 * deploy that fronts this API with something other than Cloudflare (local
 * dev, a different reverse proxy) simply never sees this header and falls
 * through to the `X-Forwarded-For` logic below unchanged.
 *
 * `X-Forwarded-For` is client-controlled unless a trusted proxy appends to it,
 * so the rightmost `TRUST_PROXY_HOPS` entries are the only trustworthy ones.
 * Taking the leftmost value — the common mistake — lets any caller spoof their
 * IP and walk straight through rate limiting.
 */
export function resolveClientIp(request: Request, directIp: string | undefined): string {
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp !== null && cfConnectingIp.length > 0) return cfConnectingIp;

  const hops = config.TRUST_PROXY_HOPS;
  if (hops === 0) return directIp ?? 'unknown';

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded === null) return directIp ?? 'unknown';

  const chain = forwarded.split(',').map((entry) => entry.trim()).filter(Boolean);
  // Count back from the right: those entries were added by our own proxies.
  const candidate = chain[Math.max(0, chain.length - hops)];

  return candidate ?? directIp ?? 'unknown';
}

export { allowedOrigins };
