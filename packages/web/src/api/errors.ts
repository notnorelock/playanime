import type { ErrorResponse } from '@playanime/contracts';

/**
 * The frontend's view of a backend failure.
 *
 * Every rejection from the API layer is one of these, so callers branch on a
 * stable `code` instead of inspecting HTTP status numbers or, worse, matching
 * on a message string that changes the moment the copy is edited.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: readonly { path: string; message: string }[];
  readonly requestId: string | undefined;

  constructor(
    message: string,
    options: {
      code: string;
      status: number;
      issues?: readonly { path: string; message: string }[];
      requestId?: string | undefined;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.issues = options.issues ?? [];
    this.requestId = options.requestId;
  }

  static is(value: unknown): value is ApiError {
    return value instanceof ApiError;
  }

  /** Field-keyed messages, for rendering errors next to form inputs. */
  get fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const issue of this.issues) {
      result[issue.path] ??= issue.message;
    }
    return result;
  }
}

/**
 * Raised when the request never reached the API — offline, DNS failure, a
 * refused connection, or a CORS rejection. Distinct from an `ApiError` because
 * nothing about the server's state can be inferred from it.
 */
export class NetworkError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('Nie udało się połączyć z serwerem.');
    this.name = 'NetworkError';
    this.cause = cause;
  }

  static is(value: unknown): value is NetworkError {
    return value instanceof NetworkError;
  }
}

/** Raised when a request is superseded or the component using it unmounts. */
export class AbortError extends Error {
  constructor() {
    super('Żądanie zostało anulowane.');
    this.name = 'AbortError';
  }

  static is(value: unknown): value is AbortError {
    return value instanceof AbortError;
  }
}

/**
 * Narrows an unknown response body to the API's error envelope.
 *
 * The body crossing the wire is untrusted, so it is validated structurally
 * rather than cast. A proxy or load balancer can return an HTML error page on
 * the same status codes the API uses, and casting that to `ErrorResponse`
 * produces `undefined.code` at the first property access.
 */
export function parseErrorEnvelope(body: unknown): ErrorResponse['error'] | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;

  const error: unknown = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;

  const code: unknown = 'code' in error ? error.code : undefined;
  const message: unknown = 'message' in error ? error.message : undefined;
  if (typeof code !== 'string' || typeof message !== 'string') return null;

  const rawIssues: unknown = 'issues' in error ? error.issues : undefined;
  const issues = Array.isArray(rawIssues)
    ? rawIssues.flatMap((issue: unknown) => {
        if (typeof issue !== 'object' || issue === null) return [];
        const path: unknown = 'path' in issue ? issue.path : undefined;
        const issueMessage: unknown = 'message' in issue ? issue.message : undefined;
        if (typeof path !== 'string' || typeof issueMessage !== 'string') return [];
        return [{ path, message: issueMessage }];
      })
    : undefined;

  const requestId: unknown = 'requestId' in error ? error.requestId : undefined;

  return {
    code,
    message,
    ...(issues === undefined ? {} : { issues }),
    ...(typeof requestId === 'string' ? { requestId } : {}),
  };
}
