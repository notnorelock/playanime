import { ValidationError } from '@playanime/shared';

/**
 * URL intake validation.
 *
 * Every externally supplied URL passes through here before any provider sees
 * it. The goal is to reject anything that could become an injection vector when
 * later placed in an `href` or an iframe `src`.
 */

/** Only these schemes may ever be stored or rendered. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

const MAX_URL_LENGTH = 2048;

/**
 * Hostnames that must never be reachable as a "source".
 *
 * Submissions are rendered as links and, for allowlisted providers, framed. A
 * loopback or link-local target is never a legitimate video host, and blocking
 * them here keeps a submitted URL from becoming an SSRF probe if a future
 * feature ever fetches one.
 */
const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
];

export class InvalidSourceUrlError extends ValidationError {
  constructor(message: string) {
    super(message, [{ path: 'url', message }]);
  }
}

/**
 * Parses and sanity-checks a submitted URL string.
 *
 * Throws `InvalidSourceUrlError` — a 422 with a client-safe message — rather
 * than returning null, because every caller treats a bad URL as a rejected
 * submission and the message is user-facing.
 */
export function parseSubmittedUrl(input: string): URL {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    throw new InvalidSourceUrlError('URL is required.');
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    throw new InvalidSourceUrlError(`URL must be at most ${MAX_URL_LENGTH} characters.`);
  }

  // Control characters can split headers or smuggle markup into an attribute.
  // eslint-disable-next-line no-control-regex -- deliberately matching control chars
  if (/[\u0000-\u001f\u007f<>"'`\\]/.test(trimmed)) {
    throw new InvalidSourceUrlError('URL contains characters that are not permitted.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidSourceUrlError('URL is not valid.');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidSourceUrlError('Only http and https URLs are accepted.');
  }

  if (url.username !== '' || url.password !== '') {
    throw new InvalidSourceUrlError('URL must not contain credentials.');
  }

  const host = url.hostname.toLowerCase();
  if (host.length === 0 || BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    throw new InvalidSourceUrlError('This host is not accepted as a source.');
  }

  return url;
}

/** Non-throwing variant, for callers that branch rather than reject. */
export function tryParseSubmittedUrl(input: string): URL | null {
  try {
    return parseSubmittedUrl(input);
  } catch {
    return null;
  }
}

/** Normalizes a hostname for comparison: lowercased, `www.` removed. */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * Host match: exact, or a subdomain of the claimed host.
 *
 * Suffix comparison is anchored on a dot so `evil-youtube.com` and
 * `youtube.com.attacker.net` do not match `youtube.com`.
 */
export function hostMatches(hostname: string, claimed: readonly string[]): boolean {
  const host = normalizeHost(hostname);
  return claimed.some((candidate) => {
    const target = candidate.toLowerCase();
    return host === target || host.endsWith(`.${target}`);
  });
}
