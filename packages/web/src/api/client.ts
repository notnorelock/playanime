import { AbortError, ApiError, NetworkError, parseErrorEnvelope } from './errors';

/**
 * The HTTP client every API call goes through.
 *
 * Built on `fetch` rather than a request library: the only things this layer
 * needs are credentialed requests, a CSRF header, and typed errors, and all
 * three are a few lines each. A dependency would add a second error model to
 * translate out of.
 *
 * Authentication is deliberately invisible here. The session lives in an
 * HttpOnly cookie that script cannot read, so there is no token to attach —
 * `credentials: 'include'` is the whole of it. Anything resembling a
 * `localStorage` token belongs to the previous backend and must not come back.
 */

/** Header the API expects to carry the double-submit CSRF token. */
const CSRF_HEADER = 'x-csrf-token';
/** Cookie the API writes the CSRF token into. Readable by design. */
const CSRF_COOKIE = 'playanime_csrf';

// Vite inlines this at build time, so a missing var is a build-time
// misconfiguration (a build run without packages/web/.env, or a Docker
// build without --build-arg VITE_API_URL) that only surfaces here, at
// runtime, in every visitor's browser — fail with a message that says so,
// instead of the opaque "Cannot read properties of undefined" a bare
// `.replace` on an unset var produces.
//
// Checked against undefined specifically, not falsiness — an empty string
// is a deliberate, valid value (see Dockerfile.web/Dockerfile.webserver's
// VITE_API_URL default) meaning "the API is same-origin," not "unset."
if (import.meta.env.VITE_API_URL === undefined) {
  throw new Error(
    'VITE_API_URL is not set. This must be set at build time (see packages/web/.env.example) — it cannot be fixed by changing runtime configuration on an already-built bundle.'
  );
}
const API_ORIGIN = import.meta.env.VITE_API_URL.replace(/\/+$/, '');
const API_PREFIX = '/api/v1';

/**
 * The API's versioned base URL, for the rare case a caller needs a full URL
 * rather than a `http.*` call — e.g. a plain browser navigation to a redirect
 * endpoint like Discord OAuth, which cannot go through `fetch`.
 */
export const API_BASE_URL = `${API_ORIGIN}${API_PREFIX}`;

/** Query values the API accepts. `undefined` means "omit the parameter". */
export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  readonly query?: QueryParams;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/**
 * Listeners notified when the API rejects a request as unauthenticated.
 *
 * The auth store subscribes to this so an expired session updates application
 * state exactly once, wherever it is discovered. The alternative — each caller
 * checking for a 401 — guarantees some caller forgets, and the app then shows a
 * signed-in shell around a signed-out session.
 */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/**
 * Endpoints whose 401 is an answer, not a session problem.
 *
 * `GET /auth/me` returns 401 for an anonymous visitor, which is the expected
 * result of "am I signed in?" — broadcasting it would make every cold load of
 * the site look like a session expiry.
 */
const SILENT_UNAUTHORIZED_PATHS = new Set(['/auth/me']);

function notifyUnauthorized(path: string): void {
  if (SILENT_UNAUTHORIZED_PATHS.has(path)) return;
  for (const listener of unauthorizedListeners) listener();
}

/** Reads a cookie by name. Returns undefined when absent or unreadable. */
function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  for (const entry of document.cookie.split(';')) {
    const trimmed = entry.trimStart();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return undefined;
}

function buildUrl(path: string, query: QueryParams | undefined): string {
  // VITE_API_URL is commonly a relative path in production (the default
  // "/api", proxied to the backend by the same origin that serves the SPA
  // — see Dockerfile.web/Dockerfile.webserver), not always an absolute
  // origin like the local-dev "http://localhost:4000". `new URL()` throws
  // "Invalid URL" on a relative input unless given a base, so pass one
  // explicitly rather than requiring every VITE_API_URL to be absolute.
  const url = new URL(`${API_ORIGIN}${API_PREFIX}${path}`, window.location.origin);

  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      // Null and undefined both mean "no filter". Serializing them would send
      // the literal string "undefined" and fail validation server-side.
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ accept: 'application/json' });
  const hasBody = options.body !== undefined;

  if (hasBody) headers.set('content-type', 'application/json');

  // The CSRF token is only required for mutations, and only exists once a
  // session has been established. Sending it when absent would be harmless but
  // sending an empty string would not — the server compares it verbatim.
  if (MUTATING_METHODS.has(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token !== undefined && token.length > 0) headers.set(CSRF_HEADER, token);
  }

  let response: Response;

  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      // Sends and accepts the session cookie cross-origin. Without it the API
      // sees every request as anonymous, and the browser discards Set-Cookie.
      credentials: 'include',
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new AbortError();
    throw new NetworkError(error);
  }

  if (response.status === 204) return undefined as T;

  // Parsed defensively: an error from a proxy in front of the API arrives with
  // an HTML body on exactly the status codes the API also uses.
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized(path);

    const envelope = parseErrorEnvelope(payload);

    throw new ApiError(envelope?.message ?? `Żądanie nie powiodło się (${String(response.status)}).`, {
      code: envelope?.code ?? 'INTERNAL_ERROR',
      status: response.status,
      ...(envelope?.issues === undefined ? {} : { issues: envelope.issues }),
      requestId: envelope?.requestId,
    });
  }

  return payload as T;
}

export const http = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('POST', path, options),
  put: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('PUT', path, options),
  patch: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('PATCH', path, options),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('DELETE', path, options),
};
