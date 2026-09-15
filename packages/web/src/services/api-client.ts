import type { ErrorResponse } from '@playanime/contracts';

/**
 * HTTP client for the PlayAnime API.
 *
 * Thin by design: it handles credentials, CSRF, error normalization and query
 * serialization, and nothing else. Endpoint-specific logic lives in the feature
 * service that owns the endpoint, so this file does not grow a method per route.
 *
 * Requests go to a relative `/api` path. In development Vite proxies that to the
 * API; in production nginx does. Either way the browser sees same-origin, so the
 * session cookie is first-party in both — which is what stops SameSite problems
 * from appearing only after deploy.
 */

const BASE_PATH = '/api/v1';

/** CSRF cookie name. Must match `CSRF_COOKIE_NAME` in `@playanime/auth`. */
const CSRF_COOKIE = 'playanime_csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * An error returned by the API, carrying its machine-readable code.
 *
 * The code is what callers branch on; `message` is already localized by the
 * server and safe to display.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: readonly { path: string; message: string }[];
  readonly requestId: string | undefined;

  constructor(
    status: number,
    body: ErrorResponse['error'],
  ) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.issues = body.issues ?? [];
    this.requestId = body.requestId;
  }

  /** True when the caller is not signed in, or the session expired. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Field errors keyed by path, for attaching messages to form inputs. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.issues.map((issue) => [issue.path, issue.message]));
  }
}

/** Raised when the request never reached the server. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Nie udało się połączyć z serwerem.', { cause });
    this.name = 'NetworkError';
  }
}

/** Reads a cookie. Used only for the CSRF token, which is deliberately readable. */
function readCookie(name: string): string | undefined {
  const match = new RegExp(`(?:^|; )${name}=([^;]*)`).exec(document.cookie);
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
}

/** Serializes query parameters, dropping empty values. */
function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    // An empty filter must not become `?genre=`, which the API would treat as a
    // request to filter by the empty string.
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Aborts the request. Passed from a resource so a stale fetch is cancelled. */
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = `${BASE_PATH}${path}${options.query ? toQueryString(options.query) : ''}`;

  const headers: Record<string, string> = {};

  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  // The API requires a CSRF token on every mutating request. Sending it on GET
  // too would be harmless but pointless.
  if (method !== 'GET') {
    const token = readCookie(CSRF_COOKIE);
    if (token !== undefined) headers[CSRF_HEADER] = token;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      // Sends the session cookie. Required even same-origin for the API to see it.
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error: unknown) {
    // An abort is a deliberate cancellation, not a failure — rethrow it
    // unchanged so callers can distinguish it from a genuine network problem.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError(error);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown;

  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(response.status, {
      code: 'INVALID_RESPONSE',
      message: 'Serwer zwrócił nieprawidłową odpowiedź.',
    });
  }

  if (!response.ok) {
    // The body may be null (empty response) or not an object at all — a proxy
    // or gateway can return a bare string on a 502. Guarded rather than cast,
    // because reading `.error` off null throws inside the error path and
    // replaces a useful API message with a TypeError.
    const body =
      typeof parsed === 'object' && parsed !== null ? (parsed as Partial<ErrorResponse>) : {};

    throw new ApiError(
      response.status,
      body.error ?? { code: 'UNKNOWN_ERROR', message: 'Wystąpił nieoczekiwany błąd.' },
    );
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),

  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
