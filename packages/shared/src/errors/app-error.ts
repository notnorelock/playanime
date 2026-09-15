import { ErrorCode } from './codes.js';

/** Field-level validation issue, shaped for direct client consumption. */
export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export interface AppErrorOptions {
  /** Machine-readable code. Part of the public contract. */
  readonly code?: ErrorCode;
  /** HTTP status this error maps to. */
  readonly status?: number;
  /**
   * Whether `message` is safe to send to clients. Defaults to true for 4xx and
   * false for 5xx. When false the serializer substitutes a generic message, so
   * an internal error can never leak a driver or SQL string.
   */
  readonly expose?: boolean;
  /** Structured, client-safe detail. Only serialized when `expose` is true. */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Underlying cause. Logged, never serialized. */
  readonly cause?: unknown;
}

/**
 * Base class for every error this application raises deliberately.
 *
 * Anything that is not an `AppError` reaching the API error handler is by
 * definition unexpected, and is reported as a generic 500.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly expose: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? ErrorCode.INTERNAL_ERROR;
    this.status = options.status ?? 500;
    this.expose = options.expose ?? this.status < 500;
    this.details = options.details;
    // V8-only API. Typed as always present by @types/node, but absent on other
    // runtimes, so the optional call is deliberate rather than redundant.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    Error.captureStackTrace?.(this, new.target);
  }

  /** True when `error` is an AppError, including across realm boundaries. */
  static is(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}

export class ValidationError extends AppError {
  readonly issues: readonly FieldIssue[];

  constructor(message = 'Request validation failed.', issues: readonly FieldIssue[] = [], options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.VALIDATION_FAILED, status: 422, expose: true, ...options });
    this.issues = issues;
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication is required.', options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.UNAUTHENTICATED, status: 401, expose: true, ...options });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have access to this resource.', options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.FORBIDDEN, status: 403, expose: true, ...options });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource could not be found.', options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.NOT_FOUND, status: 404, expose: true, ...options });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists.', options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.CONFLICT, status: 409, expose: true, ...options });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Request payload is too large.', options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.PAYLOAD_TOO_LARGE, status: 413, expose: true, ...options });
  }
}

export class RateLimitError extends AppError {
  /** Seconds until the caller may retry. Surfaced as the `Retry-After` header. */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'Too many requests.', options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.RATE_LIMITED, status: 429, expose: true, ...options });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred.', options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.INTERNAL_ERROR, status: 500, expose: false, ...options });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service is temporarily unavailable.', options: AppErrorOptions = {}) {
    super(message, { code: ErrorCode.SERVICE_UNAVAILABLE, status: 503, expose: false, ...options });
  }
}
