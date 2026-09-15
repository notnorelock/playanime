import { AppError, ValidationError, type FieldIssue } from './app-error.js';
import { ErrorCode } from './codes.js';

/** The only error shape PlayAnime ever puts on the wire. */
export interface ErrorResponseBody {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly issues?: readonly FieldIssue[];
    readonly requestId?: string;
  };
}

const GENERIC_MESSAGE = 'An unexpected error occurred.';

export interface SerializeOptions {
  /** Correlates the client-visible error with a server log line. */
  readonly requestId?: string;
}

/**
 * Converts any thrown value into a client-safe response body and status.
 *
 * Non-`AppError` values are deliberately flattened to a generic 500: an
 * unrecognized throw is an unhandled bug, and its message may contain SQL,
 * connection strings, or file paths.
 */
export function serializeError(
  error: unknown,
  options: SerializeOptions = {},
): { status: number; body: ErrorResponseBody } {
  if (AppError.is(error)) {
    const message = error.expose ? error.message : GENERIC_MESSAGE;

    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message,
          ...(error.expose && error.details ? { details: error.details } : {}),
          ...(error instanceof ValidationError && error.issues.length > 0 ? { issues: error.issues } : {}),
          ...(options.requestId ? { requestId: options.requestId } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: GENERIC_MESSAGE,
        ...(options.requestId ? { requestId: options.requestId } : {}),
      },
    },
  };
}

/** Normalizes an unknown throw into an `Error` suitable for logging. */
export function toLoggableError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}
