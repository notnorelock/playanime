import { readCappedText } from '../../http/readCappedText.js';
import type {
  RumbleFetch,
  RumbleHttpResponse,
  RumbleResolverOptions,
} from './RumbleTypes.js';
import {
  buildRumbleOEmbedUrl,
  buildRumblePlaybackMetadataUrl,
  isFetchableRumbleUrl,
} from './RumbleUrls.js';

/**
 * HTTP access to Rumble's public metadata surfaces.
 *
 * Three properties this client guarantees, none of which are optional for an
 * outbound request driven by user-submitted input:
 *
 * - **No viewer identity leaves PlayAnime.** No cookies, no `Authorization`,
 *   no forwarded browser headers. Rumble sees an anonymous request, which is
 *   all that is needed for a public video — and means a private one stays
 *   private rather than being fetched with someone's credentials.
 * - **Redirects are followed manually**, re-validating the host each hop, so a
 *   redirect cannot walk the request onto an internal address.
 * - **Bodies are read through a cap**, so a large or endless response cannot
 *   exhaust an API worker.
 */

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/**
 * Request headers for Rumble's public metadata endpoints.
 *
 * Deliberately minimal, and deliberately *not* a spoofed browser
 * `User-Agent`. Claiming to be Chrome is both dishonest and
 * counter-productive: Rumble's edge blocks a request whose UA claims a browser
 * while the rest of the connection does not look like one (verified — a
 * spoofed Chrome UA returns 403 where no UA override returns 200). Letting the
 * runtime send its own identifier is what actually works, and it means Rumble
 * can identify and rate-limit this client if it wants to.
 *
 * `Accept` is safe to state because it describes what we parse.
 */
function rumbleHeaders(): Record<string, string> {
  return {
    Accept: 'application/json, text/javascript, */*',
  };
}

export class RumbleResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Rumble response exceeded ${String(maxBytes)} bytes.`);
    this.name = 'RumbleResponseTooLargeError';
  }
}

export class RumbleUnsafeRedirectError extends Error {
  constructor(target: string) {
    // The rejected target is not interpolated: it is attacker-influenced and
    // this message may be logged.
    super('Rumble request redirected to a host that is not permitted.');
    this.name = 'RumbleUnsafeRedirectError';
    this.target = target;
  }

  readonly target: string;
}

export interface DefaultRumbleFetchOptions {
  readonly method?: 'GET' | 'HEAD';
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

/**
 * The default transport.
 *
 * `redirect: 'manual'` is the important part: `follow` would let the runtime
 * chase a `Location` header without re-checking the host, which is exactly the
 * SSRF hole that host validation on the submitted URL is meant to close.
 */
export async function defaultRumbleFetch(
  url: string,
  init: DefaultRumbleFetchOptions = {},
): Promise<RumbleHttpResponse> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = init.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isFetchableRumbleUrl(current)) {
      throw new RumbleUnsafeRedirectError(current);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetch(current, {
        method: init.method ?? 'GET',
        headers: init.headers ?? rumbleHeaders(),
        redirect: 'manual',
        signal: controller.signal,
        // No credentials, ever: this request must not carry ambient identity.
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location !== null) {
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        throw new RumbleUnsafeRedirectError(location);
      }

      // Rumble's edge answers some requests with a 307 back to the same URL as
      // a bot check. Following it again would loop, so treat it as terminal.
      if (next === current) {
        return { status: response.status, contentType: null, body: '', url: current };
      }

      current = next;
      continue;
    }

    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await readCappedText(response, maxResponseBytes, () => new RumbleResponseTooLargeError(maxResponseBytes)),
      url: current,
    };
  }

  throw new RumbleUnsafeRedirectError(current);
}

/** Rumble's public metadata endpoints, behind one injectable transport. */
export class RumbleClient {
  private readonly fetchImpl: RumbleFetch;

  constructor(options: RumbleResolverOptions = {}) {
    this.fetchImpl =
      options.fetch ??
      ((url, init) =>
        defaultRumbleFetch(url, {
          ...(init?.method === undefined ? {} : { method: init.method }),
          ...(init?.headers === undefined ? {} : { headers: init.headers }),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(options.maxResponseBytes === undefined
            ? {}
            : { maxResponseBytes: options.maxResponseBytes }),
        }));
  }

  /** Documented oEmbed endpoint: resolves a page URL to its embed identity. */
  async fetchOEmbed(pageUrl: string): Promise<RumbleHttpResponse> {
    return this.fetchImpl(buildRumbleOEmbedUrl(pageUrl));
  }

  /** The embed player's own metadata request. Provider-internal shape. */
  async fetchPlaybackMetadata(embedId: string): Promise<RumbleHttpResponse> {
    return this.fetchImpl(buildRumblePlaybackMetadataUrl(embedId));
  }
}
